"""Global assistant settings: preferences, clock context, briefing config.

Stored as key/value rows so new preferences do not need migrations.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlmodel import Session, select

from home.registry.models import Setting

DEFAULTS: dict[str, str] = {
    "user_name": "",
    "timezone": "UTC",
    "instructions": "",
    "preferences": "[]",
    "briefing_enabled": "0",
    "briefing_time": "08:00",
    "briefing_agent": "0",
    "briefing_last_sent": "",
    "daily_plan_enabled": "0",
    "daily_plan_time": "08:30",
    "daily_plan_last_sent": "",
    "weekly_review_enabled": "0",
    "weekly_review_day": "4",  # Monday=0 .. Sunday=6
    "weekly_review_time": "16:00",
    "weekly_review_last_sent": "",
    "web_fetch_enabled": "1",
}

_TRUE = {"1", "true", "yes", "on"}


def as_bool(value: str | None, default: bool = False) -> bool:
    if value in (None, ""):
        return default
    return str(value).strip().lower() in _TRUE


def get_all(db: Session) -> dict[str, str]:
    values = dict(DEFAULTS)
    for row in db.exec(select(Setting)).all():
        values[row.key] = row.value
    return values


def get(db: Session, key: str, default: str | None = None) -> str:
    row = db.get(Setting, key)
    if row is not None:
        return row.value
    return DEFAULTS.get(key, default if default is not None else "")


def get_bool(db: Session, key: str, default: bool = False) -> bool:
    return as_bool(get(db, key, "1" if default else "0"), default)


def set_many(db: Session, values: dict) -> dict[str, str]:
    for key, value in values.items():
        if key not in DEFAULTS:
            continue
        row = db.get(Setting, key)
        if row is None:
            row = Setting(key=key, value=str(value))
        else:
            row.value = str(value)
            row.updated_at = datetime.now(timezone.utc)
        db.add(row)
    db.commit()
    return get_all(db)


def preferences(db: Session) -> list[str]:
    """Global standing preferences: durable rules injected into every prompt."""
    try:
        items = json.loads(get(db, "preferences") or "[]")
    except ValueError:
        items = []
    if not isinstance(items, list):
        return []
    return [str(x).strip() for x in items if str(x).strip()]


def add_preference(db: Session, text: str) -> list[str]:
    text = (text or "").strip()
    items = preferences(db)
    if text and text not in items:
        items.append(text)
        set_many(db, {"preferences": json.dumps(items)})
    return items


def set_preference(db: Session, index: int, text: str) -> list[str]:
    text = (text or "").strip()
    items = preferences(db)
    if 0 <= index < len(items) and text:
        items[index] = text
        set_many(db, {"preferences": json.dumps(items)})
    return items


def remove_preference(db: Session, index: int) -> list[str]:
    items = preferences(db)
    if 0 <= index < len(items):
        del items[index]
        set_many(db, {"preferences": json.dumps(items)})
    return items


def timezone_name(db: Session) -> str:
    return get(db, "timezone", "UTC") or "UTC"


def local_now(db: Session) -> datetime:
    try:
        tz = ZoneInfo(timezone_name(db))
    except (ZoneInfoNotFoundError, ValueError):
        tz = timezone.utc
    return datetime.now(timezone.utc).astimezone(tz)


def origin() -> str | None:
    return (os.environ.get("HOME_ORIGIN") or "").rstrip("/") or None


def notification_url(path: str) -> str | None:
    base = origin()
    return f"{base}/#{path}" if base else None


def prompt_context(db: Session) -> str:
    """Clock + owner preferences injected into every system prompt."""
    now_utc = datetime.now(timezone.utc)
    local = local_now(db)
    lines = [
        f"Current time: {now_utc.isoformat(timespec='seconds')} UTC "
        f"(local {local.isoformat(timespec='minutes')}, {timezone_name(db)})."
    ]
    name = get(db, "user_name").strip()
    if name:
        lines.append(f"Owner: {name}.")
    instructions = get(db, "instructions").strip()
    if instructions:
        lines.append(f"Standing instructions: {instructions}")
    prefs = preferences(db)
    if prefs:
        lines.append("Standing preferences (always follow these):")
        lines.extend(f"- {p}" for p in prefs)
    return "\n".join(lines)
