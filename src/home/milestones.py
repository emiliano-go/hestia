"""Milestones: goals that group tasks and link Totem memories to outcomes."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlmodel import Session, select

from home.registry.models import Milestone, Task

STATUSES = ["open", "done"]


class InvalidMilestone(ValueError):
    """Raised for invalid milestone input; mapped to HTTP 400 / tool errors."""


def _parse_memories(raw) -> list[dict]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return []
    if not isinstance(raw, list):
        return []
    out = []
    for entry in raw:
        if isinstance(entry, dict) and entry.get("id"):
            out.append({"id": str(entry["id"]), "title": str(entry.get("title") or "")})
        elif isinstance(entry, str) and entry:
            out.append({"id": entry, "title": ""})
    return out


def _clean_status(value: str | None, default: str) -> str:
    candidate = (value or default).strip().lower()
    if candidate not in STATUSES:
        raise InvalidMilestone(f"status must be one of: {', '.join(STATUSES)}")
    return candidate


def progress(db: Session, milestone: Milestone) -> dict:
    tasks = db.exec(select(Task).where(Task.milestone_id == milestone.id)).all()
    by_status = {s: 0 for s in ("backlog", "todo", "doing", "review", "done")}
    for t in tasks:
        by_status[t.status] = by_status.get(t.status, 0) + 1
    done = by_status["done"]
    total = len(tasks)
    return {
        "total": total,
        "done": done,
        "percent": round(done / total * 100) if total else 0,
        "by_status": by_status,
    }


def as_dict(milestone: Milestone, prog: dict | None = None) -> dict:
    return {
        "id": milestone.id,
        "project_id": milestone.project_id,
        "title": milestone.title,
        "description": milestone.description,
        "target_date": milestone.target_date,
        "status": milestone.status,
        "memories": _parse_memories(milestone.memories),
        "progress": prog,
        "created_at": milestone.created_at.isoformat() if milestone.created_at else None,
        "updated_at": milestone.updated_at.isoformat() if milestone.updated_at else None,
    }


def create(
    db: Session,
    project_id: int,
    title: str,
    description: str = "",
    target_date: str | None = None,
    status: str = "open",
    memories: list | None = None,
) -> Milestone:
    title = (title or "").strip()
    if not title:
        raise InvalidMilestone("title is required")
    milestone = Milestone(
        project_id=project_id,
        title=title,
        description=description or "",
        target_date=(target_date or "").strip() or None,
        status=_clean_status(status, "open"),
        memories=json.dumps(_parse_memories(memories)),
    )
    db.add(milestone)
    db.commit()
    db.refresh(milestone)
    return milestone


def update(db: Session, milestone: Milestone, fields: dict) -> Milestone:
    if "title" in fields:
        title = (fields["title"] or "").strip()
        if not title:
            raise InvalidMilestone("title cannot be empty")
        milestone.title = title
    if "description" in fields:
        milestone.description = fields["description"] or ""
    if "target_date" in fields:
        milestone.target_date = (fields["target_date"] or "").strip() or None
    if "status" in fields:
        milestone.status = _clean_status(fields["status"], milestone.status)
    if "memories" in fields:
        milestone.memories = json.dumps(_parse_memories(fields["memories"]))
    milestone.updated_at = datetime.now(timezone.utc)
    db.add(milestone)
    db.commit()
    db.refresh(milestone)
    return milestone
