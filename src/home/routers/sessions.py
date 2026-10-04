"""Sessions, transcripts, and the Totem memory browser."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from home import totem_store
from home.registry.db import session
from home.registry.models import Message, Project, Session as ChatSession

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
