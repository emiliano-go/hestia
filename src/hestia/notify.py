"""Push notifications: ntfy and Telegram.

Both are plain HTTP POSTs (httpx is already a dependency). Configuration is
env-only, like provider keys:

    NTFY_URL=https://ntfy.sh   NTFY_TOPIC=home   NTFY_TOKEN=optional
    TELEGRAM_BOT_TOKEN=...     TELEGRAM_CHAT_ID=...

``send`` never raises: a failing channel must not break the caller (an agent
turn, the scheduler, or the inbox poller).
"""

from __future__ import annotations

import os

import httpx

_TIMEOUT = 10.0


def configured() -> list[str]:
    channels = []
    if os.environ.get("NTFY_TOPIC"):
        channels.append("ntfy")
    if os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID"):
        channels.append("telegram")
    return channels


def _ntfy(title: str, message: str, priority: str, tags: list[str], url: str | None) -> dict:
    base = (os.environ.get("NTFY_URL") or "https://ntfy.sh").rstrip("/")
    topic = os.environ["NTFY_TOPIC"]
    headers = {"Title": title, "Priority": priority}
    if tags:
        headers["Tags"] = ",".join(tags)
    if url:
        headers["Click"] = url
    token = os.environ.get("NTFY_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = httpx.post(f"{base}/{topic}", content=message.encode("utf-8"), headers=headers, timeout=_TIMEOUT)
    if resp.status_code >= 300:
        raise RuntimeError(f"ntfy {resp.status_code}: {resp.text[:200]}")
    return {"ok": True, "status": resp.status_code}


def _telegram(title: str, message: str, url: str | None) -> dict:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    chat_id = os.environ["TELEGRAM_CHAT_ID"]
    text = f"{title}\n\n{message}"
    if url:
        text += f"\n\n{url}"
    resp = httpx.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": chat_id, "text": text, "disable_web_page_preview": True},
        timeout=_TIMEOUT,
    )
    if resp.status_code >= 300:
        raise RuntimeError(f"telegram {resp.status_code}: {resp.text[:200]}")
    return {"ok": True, "status": resp.status_code}


def send(
    title: str,
    message: str = "",
    priority: str = "default",
    tags: list[str] | None = None,
    url: str | None = None,
) -> dict:
    """Send to every configured channel. Returns per-channel results."""
    results: dict[str, dict] = {}
    for channel in configured():
        try:
            if channel == "ntfy":
                results["ntfy"] = _ntfy(title, message, priority, tags or [], url)
            elif channel == "telegram":
                results["telegram"] = _telegram(title, message, url)
        except Exception as e:  # network or bad config; never break the caller
            results[channel] = {"ok": False, "error": str(e)[:200]}
    return results
