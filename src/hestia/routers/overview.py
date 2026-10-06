"""Per-project status board, activity timeline, and GitHub lists."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from hestia import overview, repos, usage
from hestia.registry.db import session
from hestia.registry.models import Project, Task

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
    entries = []
    for row in repos.repos_for(s, project.id):
        entries.append(
            {
                "alias": row.alias,
                "repo_url": row.repo_url,
                "local_path": row.local_path,
                "is_primary": row.is_primary,
                "git": overview.git_summary(Path(row.local_path)),
                "github": overview.github_summary_for_url(row.repo_url, since_dt),
            }
        )
    head = next((e for e in entries if e["is_primary"]), entries[0] if entries else None)
    git = head["git"] if head else {"branch": None, "head": None, "last_commit": None, "ahead": 0, "behind": 0, "dirty": False}
    github = head["github"] if head else {"available": False, "repo": None, "reason": "no repositories"}
    changes = overview.since_changes(
        project, since_dt, github, repo_paths=[Path(e["local_path"]) for e in entries]
    )
    return {
        "git": git,
        "github": github,
        "repos": entries,
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
    repo: str | None = None,
    s: Session = Depends(session),
):
    if kind not in ("prs", "issues", "runs"):
        raise HTTPException(400, "kind must be prs, issues, or runs")
    project = _project_or_404(project_id, s)
    rows = repos.repos_for(s, project.id)
    if repo:
        rows = [r for r in rows if r.alias == repo]
        if not rows:
            raise HTTPException(404, f"unknown repo alias: {repo}")
    if not rows:
        return {"available": False, "repo": None, "items": [], "error": "no repositories"}
    row = next((r for r in rows if r.is_primary), rows[0])
    result = overview.github_list_for_url(
        row.repo_url, kind, state=state, limit=max(1, min(limit, 100))
    )
    result["alias"] = row.alias
    return result
