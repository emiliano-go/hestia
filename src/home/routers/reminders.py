"""Reminders API: global list, project-optional."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from home import reminders
from home.registry.db import session
from home.registry.models import Project, Reminder

router = APIRouter(prefix="/api", tags=["reminders"])


@router.get("/reminders")
def list_reminders(
    project_id: int | None = None,
    include_done: bool = False,
    s: Session = Depends(session),
):
    return [
        reminders.as_dict(r)
        for r in reminders.list_all(s, project_id=project_id, include_done=include_done)
    ]


@router.post("/reminders", status_code=201)
def create_reminder(body: dict, s: Session = Depends(session)):
    project_id = body.get("project_id")
    if project_id and not s.get(Project, int(project_id)):
        raise HTTPException(404, "project not found")
    try:
        reminder = reminders.create(
            s,
            text=body.get("text", ""),
            due_at=body.get("due_at"),
            recurrence=body.get("recurrence", "none"),
            project_id=int(project_id) if project_id else None,
        )
    except reminders.InvalidReminder as e:
        raise HTTPException(400, str(e))
    return reminders.as_dict(reminder)


@router.put("/reminders/{reminder_id}")
def update_reminder(reminder_id: int, body: dict, s: Session = Depends(session)):
    reminder = s.get(Reminder, reminder_id)
    if not reminder:
        raise HTTPException(404, "reminder not found")
    try:
        if body.get("snooze_minutes"):
            reminders.snooze(s, reminder, int(body["snooze_minutes"]))
            return reminders.as_dict(reminder)
        reminders.update(s, reminder, body)
    except (reminders.InvalidReminder, TypeError, ValueError) as e:
        raise HTTPException(400, str(e))
    return reminders.as_dict(reminder)


@router.delete("/reminders/{reminder_id}", status_code=204)
def delete_reminder(reminder_id: int, s: Session = Depends(session)):
    reminder = s.get(Reminder, reminder_id)
    if not reminder:
        raise HTTPException(404, "reminder not found")
    reminders.delete(s, reminder)
