"""Events: the sense side of event-triggered automations.

Inbox polling, watchers, and task transitions emit Events. The worker matches
unhandled events against event-triggered schedules (see hestia.scheduler) and
runs the assigned agent action with the event details.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlmodel import Session, select

from hestia.registry.models import Event, Schedule

KINDS = [
    "ci_failure",
    "pr_opened",
    "issue_opened",
    "watch_hit",
    "task_review",
    "task_done",
]


def emit(
    db: Session,
    project_id: int,
    kind: str,
    payload: dict | None = None,
    key: str = "",
) -> Event | None:
    """Record an event. With a key, duplicates within (project, kind) are ignored."""
    if key:
        exists = db.exec(
            select(Event).where(
                Event.project_id == project_id,
                Event.kind == kind,
                Event.key == key,
            )
        ).first()
        if exists is not None:
            return None
    event = Event(
        project_id=project_id,
        kind=kind,
        key=key or "",
        payload=json.dumps(payload or {}, default=str),
    )
    db.add(event)
    return event


def as_dict(event: Event) -> dict:
    try:
        payload = json.loads(event.payload or "{}")
    except ValueError:
        payload = {}
    return {
        "id": event.id,
        "project_id": event.project_id,
        "kind": event.kind,
        "key": event.key,
        "payload": payload,
        "status": event.status,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "handled_at": event.handled_at.isoformat() if event.handled_at else None,
    }


def unhandled(db: Session, limit: int = 50) -> list[Event]:
    return db.exec(
        select(Event).where(Event.status == "new").order_by(Event.id).limit(limit)
    ).all()


def mark_handled(db: Session, event: Event) -> None:
    event.status = "handled"
    event.handled_at = datetime.now(timezone.utc)
    db.add(event)


def event_schedules(db: Session, project_id: int) -> list[Schedule]:
    return db.exec(
        select(Schedule).where(
            Schedule.project_id == project_id,
            Schedule.enabled == True,  # noqa: E712
            Schedule.trigger == "event",
        )
    ).all()


def matches(schedule: Schedule, event: Event) -> bool:
    if schedule.trigger != "event":
        return False
    if schedule.event and schedule.event != event.kind:
        return False
    if schedule.event_filter:
        payload = as_dict(event)["payload"]
        hay = " ".join(str(payload.get(k, "")) for k in ("title", "url", "text"))
        if schedule.event_filter.lower() not in hay.lower():
            return False
    return True
