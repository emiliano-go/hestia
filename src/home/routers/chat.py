"""Chat endpoint: SSE-streamed agent turn with Totem bootstrapping."""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from home import settings, actions, memory_ingest, questions, totem_store, usage
from home.agent import loop as agent_loop
from home.agent.prompt import build_system_prompt
from home.providers.base import OpenAIClient, resolve_api_key
from home.registry.db import session
from home.registry.models import AgentConfig, Message, Project, Provider, Session as ChatSession
from home.tools import build_registry, subagents
from home.tools import goals as goal_tools
from home.tools import questions as question_tools
from home.tools import reminders as reminder_tools
from home.tools import tasks as task_tools
from home.tools import watches as watch_tools
from home.tools.registry import ProjectContext

router = APIRouter(prefix="/api", tags=["chat"])

_DELEGATION_NOTE = """\
## Delegation
You can delegate read-only subtasks to specialised agents via run_subagent,
preferably by action (explore, github-scan, memory-keeper, writer,
code-reviewer) so the app uses the agent assigned to that role; list specific
profiles with agent_list. Delegate exploration and scanning instead of doing
everything yourself."""

_GOAL_NOTE = """\
## Goal mode
This conversation is about a project goal. Interview the user to clarify the
outcome with focused questions (one or two at a time) and keep the draft spec at
the path from the first message updated with workspace_write. Do not build the
board yourself; when the goal is clear, tell the user to press "Generate board"
on the Goals tab."""


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


@router.post("/projects/{project_id}/chat")
def chat(project_id: int, body: dict, s: Session = Depends(session)):
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")

    agent_config = None
    action_key = (body.get("action") or "chat").strip()
    if action_key not in actions.ACTIONS_BY_KEY:
        action_key = "chat"
    if body.get("agent_id"):
        agent_config = s.get(AgentConfig, body["agent_id"])
        if not agent_config:
            raise HTTPException(404, "agent profile not found")
    else:
        agent_config = actions.resolve_action(s, action_key)
    if agent_config:
        provider = s.get(Provider, agent_config.provider_id)
    else:
        provider_id = body.get("provider_id") or project.default_provider_id
        provider = s.get(Provider, provider_id) if provider_id else None
    if not provider:
        raise HTTPException(400, "no provider configured for this project")
    user_text = (body.get("message") or "").strip()
    if not user_text:
        raise HTTPException(400, "message is required")

    chat_session = None
    if body.get("session_id"):
        chat_session = s.get(ChatSession, body["session_id"])
    if chat_session is None:
        title = (user_text.splitlines()[0].strip() or "New session")[:60]
        chat_session = ChatSession(project_id=project.id, title=title)
        s.add(chat_session)
        s.commit()
        s.refresh(chat_session)

    s.add(Message(session_id=chat_session.id, role="user", content=user_text))
    chat_session.updated_at = datetime.now(timezone.utc)
    s.add(chat_session)
    s.commit()

    # A user message answers every open question in this session.
    for pending in questions.open_for_session(s, chat_session.id):
        questions.answer(s, pending, user_text)

    ctx = ProjectContext.from_project(project)
    ctx.session_id = chat_session.id
    client = OpenAIClient(provider.base_url, resolve_api_key(provider.api_key_env), provider.model)
    registry = build_registry(writes=bool(project.allow_git_writes), db=s)
    for tool in subagents.make_tools(s):
        registry.register(tool)
    for tool in task_tools.make_tools(s):
        registry.register(tool)
    for tool in goal_tools.make_tools(s):
        registry.register(tool)
    for tool in question_tools.make_tools(s):
        registry.register(tool)
    for tool in reminder_tools.make_tools(s):
        registry.register(tool)
    for tool in watch_tools.make_tools(s):
        registry.register(tool)

    digest = totem_store.digest(ctx.local_path, task=user_text)
    system = build_system_prompt(
        ctx,
        agents_md=project.agents_md,
        memory_context=digest.get("context", ""),
        user_task=user_text,
        writes_enabled=bool(project.allow_git_writes),
        extra_context=settings.prompt_context(s),
    )
    if agent_config and agent_config.system_prompt:
        system += f"\n\n## Agent instructions\n{agent_config.system_prompt}"
    system += "\n\n" + _DELEGATION_NOTE
    if action_key == "goal":
        system += "\n\n" + _GOAL_NOTE

    async def stream():
        messages = [
            {"role": "system", "content": system},
            *[
                {"role": m.role, "content": m.content}
                for m in s.exec(
                    select(Message)
                    .where(Message.session_id == chat_session.id)
                    .order_by(Message.id)
                ).all()
            ],
        ]
        full_text = ""
        tokens: dict = {}
        async for event in agent_loop.run_turn(ctx, client, registry, messages):
            if event["type"] == "usage":
                usage.merge(tokens, event.get("usage"))
                continue
            if event["type"] == "question":
                asked = event.get("question", "")
                full_text = f"{full_text}\n\n{asked}".strip() if full_text else asked
                yield _sse(
                    {
                        "event": "question",
                        "id": event.get("id"),
                        "question": asked,
                        "options": event.get("options") or [],
                        "kind": event.get("kind") or "question",
                    }
                )
                break
            if event["type"] == "message" and event.get("content"):
                full_text = event["content"]
            yield _sse({k: v for k, v in event.items() if k != "type"} | {"event": event["type"]})
        if full_text.strip():
            s.add(Message(session_id=chat_session.id, role="assistant", content=full_text))
            s.commit()
        usage.record(
            s,
            project.id,
            session_id=chat_session.id,
            action="chat",
            model=provider.model,
            usage=tokens,
        )
        if full_text.strip():
            try:
                memory_ingest.ingest_turn(ctx.local_path, user_text, full_text)
            except Exception:
                pass  # memory ingest must never break the chat
        yield _sse({"event": "session", "session_id": chat_session.id})

    return StreamingResponse(stream(), media_type="text/event-stream")
