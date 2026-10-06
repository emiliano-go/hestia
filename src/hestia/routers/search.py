"""Global search across projects."""

from fastapi import APIRouter, Depends
from sqlmodel import Session

from hestia import search
from hestia.registry.db import session

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search")
def global_search(q: str = "", limit: int = 8, s: Session = Depends(session)):
    return search.global_search(s, q, limit=max(1, min(limit, 25)))
