"""Background task API: list, inspect, and stop detached agent runs."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from home import jobs
from home.registry.db import session
from home.registry.models import BackgroundTask, Project

router = APIRouter(prefix="/api", tags=["jobs"])

_ACTIVE = ("queued", "running")


@router.get("/projects/{project_id}/jobs")
def list_jobs(
    project_id: int, active_only: bool = False, s: Session = Depends(session)
):
    if not s.get(Project, project_id):
        raise HTTPException(404, "project not found")
    query = select(BackgroundTask).where(BackgroundTask.project_id == project_id)
    if active_only:
        query = query.where(BackgroundTask.status.in_(_ACTIVE))
    rows = s.exec(query.order_by(BackgroundTask.id.desc()).limit(100)).all()
    return [jobs.as_dict(j) for j in rows]


@router.get("/jobs/{job_id}")
def get_job(job_id: int, s: Session = Depends(session)):
    job = s.get(BackgroundTask, job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return jobs.as_dict(job)


@router.post("/jobs/{job_id}/stop")
def stop_job(job_id: int, s: Session = Depends(session)):
    job = s.get(BackgroundTask, job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return jobs.stop(job_id)
