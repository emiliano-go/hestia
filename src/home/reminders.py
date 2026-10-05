"""Reminders: global one-shot or recurring nudges, fired by the worker.

Due times are stored as naive UTC (SQLite friendly); API output carries the
UTC offset. Recurrence is intentionally simple: none, daily, weekly.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from home import notify, settings
from home.registry.models import Reminder

RECURRENCES = ["none", "daily", "weekly"]


class InvalidReminder(ValueError):
    """Raised for invalid reminder input; mapped to HTTP 400 / tool errors."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _naive(value: datetime) -> datetime:
    return value.replace(tzinfo=None) if value.tzinfo else value


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return aware.isoformat()


def parse_due(value) -> datetime:
    """Parse an ISO 8601 due time (naive is treated as UTC) into naive UTC."""
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value or "").strip()
        if not text:
            raise InvalidReminder("due_at is required")
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            raise InvalidReminder("due_at must be ISO 8601, e.g. 2026-10-05T09:00:00+02:00")
    if dt.tzinfo:
        return dt.astimezone(timezone.utc)
    return dt.replace(tzinfo=timezone.utc)


def clean_recurrence(value) -> str:
    candidate = (value or "none").strip().lower()
    if candidate not in RECURRENCES:
        raise InvalidReminder(f"recurrence must be one of: {', '.join(RECURRENCES)}")
    return candidate


def as_dict(reminder: Reminder) -> dict:
    return {
        "id": reminder.id,
        "project_id": reminder.project_id,
        "text": reminder.text,
        "due_at": _iso(reminder.due_at),
        "recurrence": reminder.recurrence,
        "status": reminder.status,
        "created_at": _iso(reminder.created_at),
        "fired_at": _iso(reminder.fired_at),
    }


def create(
    db: Session,
    text: str,
    due_at,
    recurrence: str = "none",
    project_id: int | None = None,
) -> Reminder:
    text = (text or "").strip()
    if not text:
        raise InvalidReminder("text is required")
    reminder = Reminder(
        project_id=project_id,
        text=text,
        due_at=parse_due(due_at),
        recurrence=clean_recurrence(recurrence),
    )
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return reminder


def list_all(
    db: Session, project_id: int | None = None, include_done: bool = False
) -> list[Reminder]:
    query = select(Reminder)
    if project_id is not None:
        query = query.where(Reminder.project_id == project_id)
    if not include_done:
        query = query.where(Reminder.status == "pending")
    return db.exec(query.order_by(Reminder.due_at)).all()


def due(db: Session, now: datetime | None = None) -> list[Reminder]:
    now = _naive(now or _utcnow())
    rows = db.exec(
        select(Reminder).where(Reminder.status == "pending").order_by(Reminder.due_at)
    ).all()
    return [r for r in rows if _naive(r.due_at) <= now]


def fire(db: Session, reminder: Reminder, now: datetime | None = None) -> Reminder:
    now = now or _utcnow()
    notify.send(
        "Reminder",
        reminder.text,
        priority="high",
        tags=["alarm_clock"],
        url=settings.notification_url("/g/reminders"),
    )
    reminder.fired_at = now
    if reminder.recurrence in ("daily", "weekly"):
        step = timedelta(days=1) if reminder.recurrence == "daily" else timedelta(weeks=1)
        advanced = _naive(reminder.due_at) + step
        # skip past occurrences if Home was offline for a while
        while advanced <= _naive(now):
            advanced += step
        reminder.due_at = _aware(advanced)
    else:
        reminder.status = "done"
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return reminder


def fire_due(db: Session, now: datetime | None = None) -> int:
    fired = 0
    for reminder in due(db, now):
        fire(db, reminder, now)
        fired += 1
    return fired


def snooze(db: Session, reminder: Reminder, minutes: int) -> Reminder:
    reminder.due_at = _utcnow() + timedelta(minutes=max(1, int(minutes)))
    reminder.status = "pending"
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return reminder


def update(db: Session, reminder: Reminder, fields: dict) -> Reminder:
    if "text" in fields:
        text = (fields["text"] or "").strip()
        if not text:
            raise InvalidReminder("text cannot be empty")
        reminder.text = text
    if "due_at" in fields:
        reminder.due_at = parse_due(fields["due_at"])
    if "recurrence" in fields:
        reminder.recurrence = clean_recurrence(fields["recurrence"])
    if "status" in fields:
        status = (fields["status"] or "").strip().lower()
        if status not in ("pending", "done"):
            raise InvalidReminder("status must be pending or done")
        reminder.status = status
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return reminder


def delete(db: Session, reminder: Reminder) -> None:
    db.delete(reminder)
    db.commit()
