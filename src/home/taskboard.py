"""Kanban task board: shared constants and operations.

Tasks belong to a project and are independent of chat sessions. Both the REST
router and the agent's task_* tools go through here so validation and ordering
stay consistent.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import Session, select

from home.registry.models import Task

STATUSES = ["backlog", "todo", "doing", "review", "done"]
PRIORITIES = ["low", "medium", "high"]


class InvalidTask(ValueError):
    """Raised for invalid task input; mapped to HTTP 400 / tool errors."""


def as_dict(task: Task) -> dict:
    return {
        "id": task.id,
        "project_id": task.project_id,
        "milestone_id": task.milestone_id,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "priority": task.priority,
        "position": task.position,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


def _clean(value: str | None, allowed: list[str], field: str, default: str) -> str:
    candidate = (value or default).strip().lower()
    if candidate not in allowed:
        raise InvalidTask(f"{field} must be one of: {', '.join(allowed)}")
    return candidate


def next_position(db: Session, project_id: int, status: str) -> float:
    rows = db.exec(
        select(Task).where(Task.project_id == project_id, Task.status == status)
    ).all()
    return max((t.position for t in rows), default=-1.0) + 1.0


def create(
    db: Session,
    project_id: int,
    title: str,
    description: str = "",
    status: str = "backlog",
    priority: str = "medium",
    milestone_id: int | None = None,
) -> Task:
    title = (title or "").strip()
    if not title:
        raise InvalidTask("title is required")
    status = _clean(status, STATUSES, "status", "backlog")
    priority = _clean(priority, PRIORITIES, "priority", "medium")
    task = Task(
        project_id=project_id,
        milestone_id=milestone_id,
        title=title,
        description=description or "",
        status=status,
        priority=priority,
        position=next_position(db, project_id, status),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def update(db: Session, task: Task, fields: dict) -> Task:
    if "title" in fields:
        title = (fields["title"] or "").strip()
        if not title:
            raise InvalidTask("title cannot be empty")
        task.title = title
    if "description" in fields:
        task.description = fields["description"] or ""
    if "status" in fields:
        task.status = _clean(fields["status"], STATUSES, "status", task.status)
    if "priority" in fields:
        task.priority = _clean(fields["priority"], PRIORITIES, "priority", task.priority)
    if "position" in fields:
        try:
            task.position = float(fields["position"])
        except (TypeError, ValueError):
            raise InvalidTask("position must be a number")
    if "milestone_id" in fields:
        value = fields["milestone_id"]
        task.milestone_id = int(value) if value not in (None, "", 0) else None
    task.updated_at = datetime.now(timezone.utc)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task
