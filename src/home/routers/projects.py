"""Project CRUD + clone + repo status."""

import subprocess
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from home import config, totem_store
from home.registry.db import session
from home.registry.models import Project

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _clone_dir(name: str) -> Path:
    return config.data_dir() / "repos" / config.slug(name)


def _clone(repo_url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["git", "clone", "--", repo_url, str(dest)],
        capture_output=True,
        text=True,
        timeout=600,
    )
    if result.returncode != 0:
        raise HTTPException(400, f"git clone failed: {result.stderr.strip()[:500]}")


def _git_out(args: list[str], cwd: Path) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=30)
    return result.stdout.strip() if result.returncode == 0 else ""


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


@router.post("/{project_id}/pull")
def pull_project(project_id: int, s: Session = Depends(session)):
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    result = subprocess.run(
        ["git", "pull", "--ff-only"],
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
    s.commit()
    return {"output": result.stdout.strip()}


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, s: Session = Depends(session)):
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    s.delete(project)
    s.commit()
