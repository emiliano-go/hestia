"""Chat endpoint: SSE-streamed agent turn with Totem bootstrapping."""

import asyncio
import json
import os
from contextlib import suppress
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from home import actions, jobs, memory_ingest, questions, settings, skills, totem_store, usage
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

HEARTBEAT_SECONDS = float(os.environ.get("HOME_SSE_HEARTBEAT", "15"))

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

_USER_NOTE = """\
## About the owner
The owner's name and standing preferences are in your context. When the owner
tells you how to address them, call set_owner_name. When they state a durable
rule or quirk about how to respond (tone, format, length, things to avoid),
call remember_preference. Apply every standing preference without being
reminded, and never re-ask for something already remembered."""

_BACKGROUND_NOTE = """\
## Background tasks
Long jobs can run in the background: call start_background_task (or
run_subagent with run_in_background=true) with a short description. It returns
a task id immediately; keep working or stop, and a notification arrives when
it finishes (messages tagged [background task]). Use job_list and job_output
for a quick status check and job_stop to cancel; do not poll in a loop."""


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


@router.post("/projects/{project_id}/chat")
def chat(project_id: int, body: dict, s: Session = Depends(session)):
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")

    user_text = (body.get("message") or "").strip()
    if not user_text:
        raise HTTPException(400, "message is required")

    chat_session = None
    if body.get("session_id"):
        chat_session = s.get(ChatSession, body["session_id"])
        if chat_session and chat_session.project_id != project.id:
            raise HTTPException(404, "session not found")

    agent_config = None
    action_key = (
        body.get("action") or (chat_session.action if chat_session else None) or "chat"
    ).strip()
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

    if chat_session is None:
        title = (user_text.splitlines()[0].strip() or "New session")[:60]
        chat_session = ChatSession(project_id=project.id, title=title, action=action_key)
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
        skills_context=skills.summary(),
    )
    if agent_config and agent_config.system_prompt:
        system += f"\n\n## Agent instructions\n{agent_config.system_prompt}"
    system += "\n\n" + _DELEGATION_NOTE
    system += "\n\n" + _USER_NOTE
    system += "\n\n" + _BACKGROUND_NOTE
    if action_key == "goal":
        system += "\n\n" + _GOAL_NOTE

    async def _stream_impl():
        rows = s.exec(
            select(Message)
            .where(Message.session_id == chat_session.id)
            .order_by(Message.id)
        ).all()
        messages: list[dict] = [{"role": "system", "content": system}]
        for m in rows:
            if m.role == "assistant" and m.tool_calls:
                try:
                    calls = json.loads(m.tool_calls)
                except ValueError:
                    calls = []
                messages.append(
                    {"role": "assistant", "content": m.content, "tool_calls": calls}
                )
            elif m.role == "tool":
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": m.tool_call_id,
                        "name": m.name,
                        "content": m.content,
                    }
                )
            elif m.role == "notification":
                messages.append(
                    {"role": "user", "content": f"[background task]\n{m.content}"}
                )
            else:
                messages.append({"role": m.role, "content": m.content})

        full_text = ""
        tokens: dict = {}
        pending_turns: list[dict] = []
        paused = False

        queue: asyncio.Queue = asyncio.Queue()

        async def pump():
            try:
                async for event in agent_loop.run_turn(ctx, client, registry, messages):
                    await queue.put(event)
            finally:
                await queue.put(None)

        task = asyncio.create_task(pump())
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if event is None:
                    break
                etype = event["type"]
                if etype == "usage":
                    usage.merge(tokens, event.get("usage"))
                    continue
                if etype == "question":
                    asked = event.get("question", "")
                    full_text = f"{full_text}\n\n{asked}".strip() if full_text else asked
                    pending_turns = []
                    paused = True
                    yield _sse(
                        {
                            "event": "question",
                            "id": event.get("id"),
                            "question": asked,
                            "options": event.get("options") or [],
                            "kind": event.get("kind") or "question",
                        }
                    )
                    continue
                if etype == "message":
                    calls = event.get("tool_calls") or []
                    if calls:
                        pending_turns.append(
                            {"content": event.get("content") or "", "calls": calls, "results": []}
                        )
                    elif event.get("content"):
                        full_text = event["content"]
                elif etype == "tool_result" and pending_turns:
                    pending_turns[-1]["results"].append(event)
                yield _sse(
                    {k: v for k, v in event.items() if k != "type"} | {"event": etype}
                )
        finally:
            if not task.done():
                task.cancel()
            with suppress(asyncio.CancelledError):
                await task

        # Persist complete tool turns so reloads keep the chips and the next
        # turn replays valid assistant/tool pairs to the provider.
        for turn in pending_turns:
            if paused or len(turn["results"]) != len(turn["calls"]):
                continue
            s.add(
                Message(
                    session_id=chat_session.id,
                    role="assistant",
                    content=turn["content"],
                    tool_calls=json.dumps(turn["calls"]),
                )
            )
            for result in turn["results"]:
                s.add(
                    Message(
                        session_id=chat_session.id,
                        role="tool",
                        name=result.get("name"),
                        tool_call_id=result.get("id"),
                        ok=result.get("ok"),
                        content=str(result.get("preview", ""))[:20_000],
                    )
                )
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

    async def stream():
        jobs.mark_active(chat_session.id)
        try:
            async for event in _stream_impl():
                yield event
        finally:
            jobs.mark_idle(chat_session.id)

    return StreamingResponse(stream(), media_type="text/event-stream")
