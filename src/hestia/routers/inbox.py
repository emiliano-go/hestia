"""Inbox endpoints: unread GitHub notifications and marking them read."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from hestia import inbox
from hestia.registry.db import session
from hestia.registry.models import InboxItem

router = APIRouter(prefix="/api", tags=["inbox"])


@router.get("/inbox")
def list_inbox(unread: bool = False, s: Session = Depends(session)):
    return inbox.list_items(s, unread_only=unread)


@router.post("/inbox/poll")
def poll(s: Session = Depends(session)):
    return {"added": inbox.poll_all(s)}


@router.post("/inbox/read-all")
def read_all(s: Session = Depends(session)):
    for item in s.exec(select(InboxItem).where(InboxItem.read == False)).all():  # noqa: E712
        item.read = True
        s.add(item)
    s.commit()
    return {"ok": True}


@router.post("/inbox/{item_id}/read")
def mark_read(item_id: int, s: Session = Depends(session)):
    item = s.get(InboxItem, item_id)
    if not item:
        raise HTTPException(404, "inbox item not found")
    item.read = True
    s.add(item)
    s.commit()
    return {"ok": True}
