"""Assistant settings API."""

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from home import settings
from home.registry.db import session

router = APIRouter(prefix="/api/settings", tags=["settings"])

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


@router.get("")
def get_settings(s: Session = Depends(session)):
    return settings.get_all(s)


@router.put("")
def update_settings(body: dict, s: Session = Depends(session)):
    if "timezone" in body and str(body["timezone"]).strip():
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(str(body["timezone"]).strip())
        except (ZoneInfoNotFoundError, ValueError):
            raise HTTPException(400, f"unknown timezone: {body['timezone']}")
    for key in ("briefing_time", "daily_plan_time", "weekly_review_time"):
        if key in body and not _TIME_RE.match(str(body[key]).strip()):
            raise HTTPException(400, f"{key} must be HH:MM")
    if "weekly_review_day" in body:
        try:
            day = int(body["weekly_review_day"])
        except (TypeError, ValueError):
            raise HTTPException(400, "weekly_review_day must be 0 (Mon) to 6 (Sun)")
        if not 0 <= day <= 6:
            raise HTTPException(400, "weekly_review_day must be 0 (Mon) to 6 (Sun)")
    unknown = [k for k in body if k not in settings.DEFAULTS]
    if unknown:
        raise HTTPException(400, f"unknown setting: {', '.join(unknown)}")
    return settings.set_many(s, body)


@router.get("/preferences")
def list_preferences(s: Session = Depends(session)):
    return {"preferences": settings.preferences(s)}


@router.post("/preferences", status_code=201)
def add_preference(body: dict, s: Session = Depends(session)):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "text is required")
    return {"preferences": settings.add_preference(s, text)}


@router.put("/preferences/{index}")
def set_preference(index: int, body: dict, s: Session = Depends(session)):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "text is required")
    return {"preferences": settings.set_preference(s, index, text)}


@router.delete("/preferences/{index}")
def remove_preference(index: int, s: Session = Depends(session)):
    return {"preferences": settings.remove_preference(s, index)}
