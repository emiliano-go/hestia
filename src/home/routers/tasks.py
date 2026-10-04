"""Kanban task board: per-project CRUD, independent of chat sessions."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from home import taskboard
from home.registry.db import session
from home.registry.models import Project, Task

router = APIRouter(prefix="/api", tags=["tasks"])


def _project_or_404(project_id: int, s: Session) -> Project:
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    return project


@router.get("/projects/{project_id}/tasks")
def list_tasks(project_id: int, s: Session = Depends(session)):
    _project_or_404(project_id, s)
    return s.exec(
        select(Task).where(Task.project_id == project_id).order_by(Task.position, Task.id)
    ).all()


@router.post("/projects/{project_id}/tasks", status_code=201)
def create_task(project_id: int, body: dict, s: Session = Depends(session)):
    _project_or_404(project_id, s)
    try:
        task = taskboard.create(
            s,
            project_id,
            title=body.get("title", ""),
            description=body.get("description", ""),
            status=body.get("status", "backlog"),
            priority=body.get("priority", "medium"),
            milestone_id=body.get("milestone_id"),
        )
    except taskboard.InvalidTask as e:
        raise HTTPException(400, str(e))
    return task


@router.put("/tasks/{task_id}")
def update_task(task_id: int, body: dict, s: Session = Depends(session)):
    task = s.get(Task, task_id)
    if not task:
        raise HTTPException(404, "task not found")
    try:
        taskboard.update(s, task, body)
    except taskboard.InvalidTask as e:
        raise HTTPException(400, str(e))
    return task


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, s: Session = Depends(session)):
    task = s.get(Task, task_id)
    if not task:
        raise HTTPException(404, "task not found")
    s.delete(task)
    s.commit()
