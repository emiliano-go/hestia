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
    if "briefing_time" in body and not _TIME_RE.match(str(body["briefing_time"]).strip()):
        raise HTTPException(400, "briefing_time must be HH:MM")
    unknown = [k for k in body if k not in settings.DEFAULTS]
    if unknown:
        raise HTTPException(400, f"unknown setting: {', '.join(unknown)}")
    return settings.set_many(s, body)
