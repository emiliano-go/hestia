"""Project CRUD + clone + repo status."""

import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import delete
from sqlmodel import Session, select

from hestia import config, totem_store
from hestia.registry.db import session
from hestia.registry.models import (
    Goal,
    InboxItem,
    Message,
    Milestone,
    Project,
    Reminder,
    Schedule,
    Task,
    TaskComment,
    Usage,
    Watch,
)
from hestia.registry.models import Session as ChatSession

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _clone_dir(name: str) -> Path:
    return config.data_dir() / "repos" / config.slug(name)


def _auth_args(repo_url: str) -> list[str]:
    """git -c flags for authenticated GitHub HTTPS remotes (token from env or UI)."""
    token = config.github_token()
    if token and "github.com" in (repo_url or ""):
        return ["-c", f"http.extraheader=Authorization: Bearer {token}"]
    return []


def _clone(repo_url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["git", *_auth_args(repo_url), "clone", "--", repo_url, str(dest)],
        capture_output=True,
        text=True,
        timeout=600,
    )
    if result.returncode != 0:
        raise HTTPException(400, f"git clone failed: {result.stderr.strip()[:500]}")


def _git_out(args: list[str], cwd: Path) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=30)
    return result.stdout.strip() if result.returncode == 0 else ""


_PROGRESS_RE = re.compile(r"(Receiving objects|Resolving deltas):\s+(\d+)%")


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


def _clone_output(repo_url: str, dest: Path):
    """Run `git clone --progress`, yielding each output line as it arrives."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        ["git", *_auth_args(repo_url), "clone", "--progress", "--", repo_url, str(dest)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    lines: list[str] = []
    buf = ""
    while True:
        ch = proc.stdout.read(1)
        if not ch:
            break
        if ch in "\r\n":
            line = buf.strip()
            buf = ""
            if line:
                lines.append(line)
                yield line
        else:
            buf += ch
    proc.wait()
    yield {"exit": proc.returncode, "lines": lines}


def _create_project_events(name: str, repo_url: str, s: Session):
    """Yield SSE events for each real step of creating a project."""
    dest = _clone_dir(name)
    if dest.exists():
        yield _sse({"event": "error", "detail": f"clone directory already exists: {dest}"})
        return

    yield _sse(
        {"event": "step", "step": "clone", "label": "Cloning repository", "status": "running"}
    )
    returncode = None
    lines: list[str] = []
    for item in _clone_output(repo_url, dest):
        if isinstance(item, dict):
            returncode, lines = item["exit"], item["lines"]
            continue
        m = _PROGRESS_RE.search(item)
        if m:
            yield _sse(
                {
                    "event": "progress",
                    "step": "clone",
                    "percent": int(m.group(2)),
                    "detail": item,
                }
            )
    if returncode != 0:
        detail = "\n".join(lines[-8:]) or f"git clone exited {returncode}"
        yield _sse({"event": "error", "detail": f"git clone failed: {detail[:500]}"})
        return
    yield _sse({"event": "step", "step": "clone", "status": "done"})

    yield _sse(
        {"event": "step", "step": "agents", "label": "Reading AGENTS.md", "status": "running"}
    )
    agents = dest / "AGENTS.md"
    agents_md = agents.read_text()[:20_000] if agents.exists() else None
    yield _sse({"event": "step", "step": "agents", "status": "done"})

    yield _sse(
        {
            "event": "step",
            "step": "memory",
            "label": "Initializing project memory",
            "status": "running",
        }
    )
    project = Project(
        name=name, repo_url=repo_url, local_path=str(dest), agents_md=agents_md
    )
    s.add(project)
    s.commit()
    s.refresh(project)
    totem_store.recent(dest)  # opens + inits the Totem DB on first use
    yield _sse({"event": "step", "step": "memory", "status": "done"})
    yield _sse({"event": "done", "project": project.model_dump(mode="json")})


@router.post("/stream")
def create_project_stream(body: dict, s: Session = Depends(session)):
    """Create a project while streaming clone/init progress as SSE."""
    name = (body.get("name") or "").strip()
    repo_url = (body.get("repo_url") or "").strip()
    if not name or not repo_url:
        raise HTTPException(400, "name and repo_url are required")
    return StreamingResponse(
        _create_project_events(name, repo_url, s), media_type="text/event-stream"
    )


@router.get("")
def list_projects(s: Session = Depends(session)):
    return s.exec(select(Project)).all()


@router.post("", status_code=201)
def create_project(body: dict, s: Session = Depends(session)):
    name = (body.get("name") or "").strip()
    repo_url = (body.get("repo_url") or "").strip()
    if not name or not repo_url:
        raise HTTPException(400, "name and repo_url are required")
    dest = _clone_dir(name)
    if dest.exists():
        raise HTTPException(409, f"clone directory already exists: {dest}")
    _clone(repo_url, dest)
    agents = dest / "AGENTS.md"
    project = Project(
        name=name,
        repo_url=repo_url,
        local_path=str(dest),
        agents_md=agents.read_text()[:20_000] if agents.exists() else None,
    )
    s.add(project)
    s.commit()
    s.refresh(project)
    totem_store.recent(dest)  # opens + inits the Totem DB on first use
    return project


@router.get("/{project_id}")
def get_project(project_id: int, s: Session = Depends(session)):
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    path = Path(project.local_path)
    status = {
        "head": _git_out(["rev-parse", "--short", "HEAD"], path),
        "branch": _git_out(["rev-parse", "--abbrev-ref", "HEAD"], path),
        "behind": "",
    }
    return {**project.model_dump(), "status": status}


@router.post("/{project_id}/open")
def open_project(project_id: int, s: Session = Depends(session)):
    """Mark a project as recently opened (drives the landing dashboard)."""
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    previous = project.last_opened_at
    project.last_opened_at = datetime.now(timezone.utc)
    s.add(project)
    s.commit()
    s.refresh(project)
    return {
        **project.model_dump(),
        "previous_opened_at": previous.isoformat() if previous else None,
    }


@router.put("/{project_id}")
def update_project(project_id: int, body: dict, s: Session = Depends(session)):
    """Update budget settings (token_budget, budget_enforced)."""
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    if "token_budget" in body:
        value = body["token_budget"]
        try:
            project.token_budget = int(value) if value not in (None, "", 0) else None
        except (TypeError, ValueError):
            raise HTTPException(400, "token_budget must be a number")
    if "budget_enforced" in body:
        project.budget_enforced = bool(body["budget_enforced"])
    if "require_write_approval" in body:
        project.require_write_approval = bool(body["require_write_approval"])
    s.add(project)
    s.commit()
    s.refresh(project)
    return project


@router.put("/{project_id}/git-writes")
def set_git_writes(project_id: int, body: dict, s: Session = Depends(session)):
    """Explicit opt-in for mutating git tools (branch/commit/push/PR)."""
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    project.allow_git_writes = bool(body.get("enabled"))
    s.add(project)
    s.commit()
    s.refresh(project)
    return project


@router.post("/{project_id}/pull")
def pull_project(project_id: int, s: Session = Depends(session)):
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    result = subprocess.run(
        ["git", *_auth_args(project.repo_url), "pull", "--ff-only"],
        cwd=project.local_path,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise HTTPException(400, result.stderr.strip()[:500])
    agents = Path(project.local_path) / "AGENTS.md"
    project.agents_md = agents.read_text()[:20_000] if agents.exists() else None
    s.add(project)
    # the pull is done: clear any "Pull pending" inbox item
    s.exec(
        delete(InboxItem).where(
            InboxItem.project_id == project_id, InboxItem.kind == "pull"
        )
    )
    s.commit()
    return {"output": result.stdout.strip()}


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, s: Session = Depends(session)):
    """Delete a project, every row that belongs to it, and its clone/workspace."""
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")

    session_ids = list(
        s.exec(select(ChatSession.id).where(ChatSession.project_id == project_id)).all()
    )
    task_ids = list(
        s.exec(select(Task.id).where(Task.project_id == project_id)).all()
    )
    if session_ids:
        s.exec(delete(Message).where(Message.session_id.in_(session_ids)))
    if task_ids:
        s.exec(delete(TaskComment).where(TaskComment.task_id.in_(task_ids)))
    for model in (
        Task,
        Milestone,
        Goal,
        Schedule,
        Reminder,
        Watch,
        InboxItem,
        Usage,
        ChatSession,
    ):
        s.exec(delete(model).where(model.project_id == project_id))
    s.delete(project)
    s.commit()

    shutil.rmtree(config.data_dir() / "repos" / config.slug(project.name), ignore_errors=True)
    shutil.rmtree(
        config.data_dir() / "workspaces" / config.slug(project.name), ignore_errors=True
    )
