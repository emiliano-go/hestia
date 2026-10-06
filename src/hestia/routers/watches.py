"""Watchers API: list, create, update (pause/resume), delete, check now."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from hestia import watchers
from hestia.registry.db import session
from hestia.registry.models import Project, Watch

router = APIRouter(prefix="/api", tags=["watches"])


@router.get("/watches")
def list_watches(s: Session = Depends(session)):
    return [watchers.as_dict(w) for w in watchers.list_all(s)]


@router.post("/watches", status_code=201)
def create_watch(body: dict, s: Session = Depends(session)):
    project_id = body.get("project_id")
    if project_id and not s.get(Project, int(project_id)):
        raise HTTPException(404, "project not found")
    try:
        watch = watchers.create(
            s,
            kind=body.get("kind", "page"),
            url=body.get("url"),
            condition=body.get("condition", ""),
            interval_minutes=body.get("interval_minutes", 60),
            notify_on=body.get("notify_on", "change"),
            project_id=int(project_id) if project_id else None,
        )
    except watchers.InvalidWatch as e:
        raise HTTPException(400, str(e))
    return watchers.as_dict(watch)


@router.put("/watches/{watch_id}")
def update_watch(watch_id: int, body: dict, s: Session = Depends(session)):
    watch = s.get(Watch, watch_id)
    if not watch:
        raise HTTPException(404, "watch not found")
    try:
        watchers.update(s, watch, body)
    except watchers.InvalidWatch as e:
        raise HTTPException(400, str(e))
    return watchers.as_dict(watch)


@router.delete("/watches/{watch_id}", status_code=204)
def delete_watch(watch_id: int, s: Session = Depends(session)):
    watch = s.get(Watch, watch_id)
    if not watch:
        raise HTTPException(404, "watch not found")
    watchers.delete(s, watch)


@router.post("/watches/{watch_id}/check")
async def check_watch(watch_id: int, s: Session = Depends(session)):
    watch = s.get(Watch, watch_id)
    if not watch:
        raise HTTPException(404, "watch not found")
    await watchers.check(s, watch)
    return watchers.as_dict(watch)
