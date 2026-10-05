"""Per-project status board, activity timeline, and GitHub lists."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from home import overview, usage
from home.registry.db import session
from home.registry.models import Project, Task

router = APIRouter(prefix="/api/projects", tags=["overview"])


def _project_or_404(project_id: int, s: Session) -> Project:
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    return project


def _task_counts(project_id: int, s: Session) -> dict:
    tasks = s.exec(select(Task).where(Task.project_id == project_id)).all()
    by_status = {status: 0 for status in ("backlog", "todo", "doing", "review", "done")}
    for t in tasks:
        by_status[t.status] = by_status.get(t.status, 0) + 1
    open_count = sum(v for k, v in by_status.items() if k != "done")
    return {"total": len(tasks), "open": open_count, "by_status": by_status}


@router.get("/{project_id}/status")
def status(project_id: int, since: str | None = None, s: Session = Depends(session)):
    project = _project_or_404(project_id, s)
    since_dt = overview._parse_dt(since) if since else project.last_opened_at
    github = overview.github_summary(project, since_dt)
    changes = overview.since_changes(project, since_dt, github)
    return {
        "git": overview.git_summary(Path(project.local_path)),
        "github": github,
        "since": overview._iso(since_dt),
        "changes": changes,
        "tasks": _task_counts(project_id, s),
    }


@router.get("/{project_id}/usage")
def project_usage(project_id: int, s: Session = Depends(session)):
    _project_or_404(project_id, s)
    return usage.summary(s, project_id)


@router.get("/{project_id}/activity")
def activity(
    project_id: int,
    limit: int = 80,
    github: bool = True,
    s: Session = Depends(session),
):
    project = _project_or_404(project_id, s)
    items = overview.project_activity(
        project, s, limit=max(1, min(limit, 200)), include_github=github
    )
    return {"items": items}


@router.get("/{project_id}/github")
def github_list(
    project_id: int,
    kind: str = "prs",
    state: str = "open",
    limit: int = 30,
    s: Session = Depends(session),
):
    if kind not in ("prs", "issues", "runs"):
        raise HTTPException(400, "kind must be prs, issues, or runs")
    project = _project_or_404(project_id, s)
    return overview.github_list(
        project, kind, state=state, limit=max(1, min(limit, 100))
    )
