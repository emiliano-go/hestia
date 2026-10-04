"""Chat endpoint: SSE-streamed agent turn with Totem bootstrapping."""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from home import actions, memory_ingest, totem_store
from home.agent import loop as agent_loop
from home.agent.prompt import build_system_prompt
from home.providers.base import OpenAIClient, resolve_api_key
from home.registry.db import session
from home.registry.models import AgentConfig, Message, Project, Provider, Session as ChatSession
from home.tools import build_registry, subagents
from home.tools import tasks as task_tools
from home.tools.registry import ProjectContext

router = APIRouter(prefix="/api", tags=["chat"])

_DELEGATION_NOTE = """\
## Delegation
You can delegate read-only subtasks to specialised agents via run_subagent,
preferably by action (explore, github-scan, memory-keeper, writer,
code-reviewer) so the app uses the agent assigned to that role; list specific
profiles with agent_list. Delegate exploration and scanning instead of doing
everything yourself."""


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


@router.post("/projects/{project_id}/chat")
def chat(project_id: int, body: dict, s: Session = Depends(session)):
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")

    agent_config = None
    if body.get("agent_id"):
        agent_config = s.get(AgentConfig, body["agent_id"])
        if not agent_config:
            raise HTTPException(404, "agent profile not found")
    else:
        agent_config = actions.resolve_action(s, "chat")
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
        chat_session = ChatSession(project_id=project.id, title=user_text[:60])
        s.add(chat_session)
        s.commit()
        s.refresh(chat_session)

    s.add(Message(session_id=chat_session.id, role="user", content=user_text))
    chat_session.updated_at = datetime.now(timezone.utc)
    s.add(chat_session)
    s.commit()

    ctx = ProjectContext.from_project(project)
    client = OpenAIClient(provider.base_url, resolve_api_key(provider.api_key_env), provider.model)
    registry = build_registry()
    for tool in subagents.make_tools(s):
        registry.register(tool)
    for tool in task_tools.make_tools(s):
        registry.register(tool)

    digest = totem_store.digest(ctx.local_path, task=user_text)
    system = build_system_prompt(
        ctx,
        agents_md=project.agents_md,
        memory_context=digest.get("context", ""),
        user_task=user_text,
    )
    if agent_config and agent_config.system_prompt:
        system += f"\n\n## Agent instructions\n{agent_config.system_prompt}"
    system += "\n\n" + _DELEGATION_NOTE

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
        async for event in agent_loop.run_turn(ctx, client, registry, messages):
            if event["type"] == "message" and event.get("content"):
                full_text = event["content"]
            yield _sse({k: v for k, v in event.items() if k != "type"} | {"event": event["type"]})
        s.add(Message(session_id=chat_session.id, role="assistant", content=full_text))
        s.commit()
        try:
            memory_ingest.ingest_turn(ctx.local_path, user_text, full_text)
        except Exception:
            pass  # memory ingest must never break the chat
        yield _sse({"event": "session", "session_id": chat_session.id})

    return StreamingResponse(stream(), media_type="text/event-stream")
