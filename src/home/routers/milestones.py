"""Milestone (roadmap goal) CRUD, grouped with their tasks and progress."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from home import milestones
from home.registry.db import session
from home.registry.models import Milestone, Project, Task

router = APIRouter(prefix="/api", tags=["milestones"])


def _project_or_404(project_id: int, s: Session) -> Project:
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    return project


@router.get("/projects/{project_id}/milestones")
def list_milestones(project_id: int, s: Session = Depends(session)):
    _project_or_404(project_id, s)
    items = s.exec(
        select(Milestone)
        .where(Milestone.project_id == project_id)
        .order_by(Milestone.status, Milestone.created_at)
    ).all()
    return [milestones.as_dict(m, milestones.progress(s, m)) for m in items]


@router.post("/projects/{project_id}/milestones", status_code=201)
def create_milestone(project_id: int, body: dict, s: Session = Depends(session)):
    _project_or_404(project_id, s)
    try:
        milestone = milestones.create(
            s,
            project_id,
            title=body.get("title", ""),
            description=body.get("description", ""),
            target_date=body.get("target_date"),
            status=body.get("status", "open"),
            memories=body.get("memories"),
        )
    except milestones.InvalidMilestone as e:
        raise HTTPException(400, str(e))
    return milestones.as_dict(milestone, milestones.progress(s, milestone))


@router.put("/milestones/{milestone_id}")
def update_milestone(milestone_id: int, body: dict, s: Session = Depends(session)):
    milestone = s.get(Milestone, milestone_id)
    if not milestone:
        raise HTTPException(404, "milestone not found")
    try:
        milestones.update(s, milestone, body)
    except milestones.InvalidMilestone as e:
        raise HTTPException(400, str(e))
    return milestones.as_dict(milestone, milestones.progress(s, milestone))


@router.delete("/milestones/{milestone_id}", status_code=204)
def delete_milestone(milestone_id: int, s: Session = Depends(session)):
    milestone = s.get(Milestone, milestone_id)
    if not milestone:
        raise HTTPException(404, "milestone not found")
    # Detach tasks rather than deleting them.
    for task in s.exec(select(Task).where(Task.milestone_id == milestone_id)).all():
        task.milestone_id = None
        s.add(task)
    s.delete(milestone)
    s.commit()
