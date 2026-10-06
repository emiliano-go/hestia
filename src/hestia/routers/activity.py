"""Landing dashboard: recent projects, conversations, and generated files."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from hestia import config
from hestia.registry.db import session
from hestia.registry.models import Project
from hestia.registry.models import Session as ChatSession
from hestia.routers.workspace import _list_files

router = APIRouter(prefix="/api", tags=["activity"])


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


@router.get("/activity")
def activity(s: Session = Depends(session)):
    projects = s.exec(select(Project)).all()
    by_id = {p.id: p for p in projects}

    recent_projects = sorted(
        projects,
        key=lambda p: p.last_opened_at or p.created_at,
        reverse=True,
    )[:6]

    sessions = s.exec(select(ChatSession)).all()
    sessions.sort(key=lambda c: c.updated_at, reverse=True)
    recent_sessions = [
        {
            "id": c.id,
            "project_id": c.project_id,
            "project": by_id[c.project_id].name if c.project_id in by_id else "",
            "title": c.title,
            "updated_at": _iso(c.updated_at),
        }
        for c in sessions[:8]
    ]

    files = []
    for p in projects:
        root = config.workspace_dir(p.name)
        for rel in _list_files(root, "*", limit=200):
            st = (root / rel).stat()
            files.append({
                "project_id": p.id,
                "project": p.name,
                "path": rel,
                "bytes": st.st_size,
                "modified": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
            })
    files.sort(key=lambda f: f["modified"], reverse=True)

    return {
        "projects": [
            {
                "id": p.id,
                "name": p.name,
                "repo_url": p.repo_url,
                "last_opened_at": _iso(p.last_opened_at),
                "created_at": _iso(p.created_at),
            }
            for p in recent_projects
        ],
        "sessions": recent_sessions,
        "files": files[:8],
        "counts": {
            "projects": len(projects),
            "sessions": len(sessions),
            "files": len(files),
        },
    }
