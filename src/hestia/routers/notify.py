"""Notification channel status and a test send."""

import os

from fastapi import APIRouter, HTTPException

from hestia import notify

router = APIRouter(prefix="/api/notify", tags=["notify"])


@router.get("/status")
def status():
    return {
        "configured": notify.configured(),
        "channels": {
            "ntfy": bool(os.environ.get("NTFY_TOPIC")),
            "telegram": bool(
                os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID")
            ),
        },
    }


@router.post("/test")
def test():
    if not notify.configured():
        raise HTTPException(
            400,
            "no notification channel configured (set NTFY_TOPIC or "
            "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID)",
        )
    results = notify.send(
        "Hestia test notification",
        "Notifications are configured correctly.",
        tags=["white_check_mark"],
    )
    if not any(r.get("ok") for r in results.values()):
        raise HTTPException(502, f"send failed: {results}")
    return results
