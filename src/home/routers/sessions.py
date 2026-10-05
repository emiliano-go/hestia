"""Sessions, transcripts, and the Totem memory browser."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from home import actions, questions, totem_store, usage
from home.registry.db import session
from home.registry.models import Message, Project, Provider, Question
from home.registry.models import Session as ChatSession

router = APIRouter(prefix="/api", tags=["sessions"])


@router.get("/projects/{project_id}/sessions")
def list_sessions(project_id: int, s: Session = Depends(session)):
    if not s.get(Project, project_id):
        raise HTTPException(404, "project not found")
    return s.exec(
        select(ChatSession).where(ChatSession.project_id == project_id)
    ).all()


@router.get("/sessions/{session_id}/messages")
def get_messages(session_id: int, s: Session = Depends(session)):
    if not s.get(ChatSession, session_id):
        raise HTTPException(404, "session not found")
    return s.exec(
        select(Message).where(Message.session_id == session_id).order_by(Message.id)
    ).all()


@router.get("/projects/{project_id}/memory")
def browse_memory(project_id: int, q: str | None = None, s: Session = Depends(session)):
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    path = project.local_path
    if q:
        return totem_store.search(path, q, limit=50)
    return totem_store.list_all(path, limit=100)


@router.get("/sessions/{session_id}/questions")
def list_questions(session_id: int, s: Session = Depends(session)):
    if not s.get(ChatSession, session_id):
        raise HTTPException(404, "session not found")
    return [questions.as_dict(q) for q in questions.list_for_session(s, session_id)]


@router.post("/questions/{question_id}/dismiss")
def dismiss_question(question_id: int, s: Session = Depends(session)):
    question = s.get(Question, question_id)
    if not question:
        raise HTTPException(404, "question not found")
    return questions.as_dict(questions.dismiss(s, question))


FIXER_PROMPT = """\
You are the memory curator of a project cockpit. You are given the project's
Totem memory below. Your job is to apply the user's instruction: fix wrong or
stale entries (memory_update, memory_delete), fill gaps (memory_create), and
merge duplicates. Be conservative: only change what the instruction clearly
calls for. End with a short plain-text report of every change made.


## Project memory
"""


@router.post("/projects/{project_id}/memory/fix")
def fix_memory(project_id: int, body: dict, s: Session = Depends(session)):
    """Run a memory-only agent over the project memory to apply fixes."""
    import asyncio

    from home.agent import loop as agent_loop
    from home.providers.base import OpenAIClient, resolve_api_key
    from home.tools import build_registry
    from home.tools.registry import ProjectContext

    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    instruction = (body.get("instruction") or "").strip()
    if not instruction:
        raise HTTPException(400, "instruction is required")
    agent_config = actions.resolve_action(s, "memory-fix")
    provider_id = (
        body.get("provider_id")
        or (agent_config.provider_id if agent_config else None)
        or project.default_provider_id
    )
    provider = s.get(Provider, provider_id) if provider_id else None
    if not provider:
        raise HTTPException(400, "no provider configured for this project")

    memories = totem_store.list_all(Path(project.local_path), limit=200)
    catalog = "\n".join(
        f'- id={m["id"]} type={m["type"]} status={m["status"]} title={m["title"]}\n  {m["statement"][:400]}'
        for m in memories
    ) or "(memory is empty)"
    system = FIXER_PROMPT + catalog

    client = OpenAIClient(provider.base_url, resolve_api_key(provider.api_key_env), provider.model)
    registry = build_registry().filtered(["memory"])
    ctx = ProjectContext.from_project(project)
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": instruction},
    ]

    async def run():
        final = ""
        tokens: dict = {}
        async for event in agent_loop.run_turn(ctx, client, registry, messages):
            if event["type"] == "usage":
                usage.merge(tokens, event.get("usage"))
                continue
            if event["type"] == "message":
                final = event.get("content", "")
            if event["type"] == "error":
                return "", event["message"], tokens
        return final, None, tokens

    report, error, tokens = asyncio.run(run())
    usage.record(s, project.id, action="memory-fix", model=provider.model, usage=tokens)
    if error:
        raise HTTPException(502, error)
    return {"report": report}
