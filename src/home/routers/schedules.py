"""Scheduled agent runs: per-project CRUD and "run now"."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from home import actions, scheduler
from home.registry.db import session
from home.registry.models import Project, Schedule

router = APIRouter(prefix="/api", tags=["schedules"])

MIN_INTERVAL = 1  # minutes


def _validate_action(action: str) -> str:
    action = (action or "chat").strip()
    if action not in actions.ACTIONS_BY_KEY:
        raise HTTPException(400, f"unknown action: {action}")
    return action


def _validate_interval(value) -> int:
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        raise HTTPException(400, "interval_minutes must be a number")
    return max(MIN_INTERVAL, minutes)


@router.get("/projects/{project_id}/schedules")
def list_schedules(project_id: int, s: Session = Depends(session)):
    if not s.get(Project, project_id):
        raise HTTPException(404, "project not found")
    rows = s.exec(
        select(Schedule).where(Schedule.project_id == project_id).order_by(Schedule.id)
    ).all()
    return [scheduler.as_dict(r) for r in rows]


@router.post("/projects/{project_id}/schedules", status_code=201)
def create_schedule(project_id: int, body: dict, s: Session = Depends(session)):
    if not s.get(Project, project_id):
        raise HTTPException(404, "project not found")
    schedule = Schedule(
        project_id=project_id,
        action=_validate_action(body.get("action", "chat")),
        instruction=(body.get("instruction") or "").strip(),
        interval_minutes=_validate_interval(body.get("interval_minutes", 1440)),
        enabled=bool(body.get("enabled", True)),
    )
    s.add(schedule)
    s.commit()
    s.refresh(schedule)
    return scheduler.as_dict(schedule)


@router.put("/schedules/{schedule_id}")
def update_schedule(schedule_id: int, body: dict, s: Session = Depends(session)):
    schedule = s.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(404, "schedule not found")
    if "action" in body:
        schedule.action = _validate_action(body["action"])
    if "instruction" in body:
        schedule.instruction = (body["instruction"] or "").strip()
    if "interval_minutes" in body:
        schedule.interval_minutes = _validate_interval(body["interval_minutes"])
    if "enabled" in body:
        schedule.enabled = bool(body["enabled"])
    s.add(schedule)
    s.commit()
    s.refresh(schedule)
    return scheduler.as_dict(schedule)


@router.delete("/schedules/{schedule_id}", status_code=204)
def delete_schedule(schedule_id: int, s: Session = Depends(session)):
    schedule = s.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(404, "schedule not found")
    s.delete(schedule)
    s.commit()


@router.post("/schedules/{schedule_id}/run")
async def run_now(schedule_id: int):
    result = await scheduler.run_schedule(schedule_id)
    if result is None:
        raise HTTPException(404, "schedule not found")
    return result
