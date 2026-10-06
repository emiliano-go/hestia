"""Skills API: list, install, read, remove installable agent skills."""

from fastapi import APIRouter, HTTPException

from hestia import skills

router = APIRouter(prefix="/api/skills", tags=["skills"])


@router.get("")
def list_skills():
    return [s.as_dict() for s in skills.list_installed()]


@router.post("/install", status_code=201)
def install_skill(body: dict):
    source = (body.get("source") or "").strip()
    try:
        installed = skills.install(source, body.get("subpath"))
    except skills.InvalidSource as e:
        raise HTTPException(400, str(e))
    return [s.as_dict() for s in installed]


@router.get("/{slug}")
def get_skill(slug: str):
    try:
        skill = skills.get(slug)
    except skills.InvalidSource:
        raise HTTPException(404, "skill not found")
    return {**skill.as_dict(), "body": skill.body}


@router.delete("/{slug}", status_code=204)
def delete_skill(slug: str):
    try:
        skills.remove(slug)
    except skills.InvalidSource:
        raise HTTPException(404, "skill not found")
