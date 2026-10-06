"""GitHub account connection: status, token, gh import, device + OAuth flows."""

import os
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlmodel import Session

from home import github_auth, settings
from home.registry.db import session

router = APIRouter(prefix="/api/github", tags=["github"])


def _client_id(s: Session) -> str:
    return (
        settings.get(s, "github_oauth_client_id")
        or os.environ.get("GITHUB_OAUTH_CLIENT_ID")
        or ""
    )


def _base_url(request: Request) -> str:
    """HOME_ORIGIN when set (behind a proxy); otherwise the request's own origin."""
    return settings.origin() or f"{request.url.scheme}://{request.url.netloc}"


def _settings_url(base: str, status: str, reason: str | None = None) -> str:
    url = f"{base.rstrip('/')}/?github={status}"
    if reason:
        url += f"&reason={quote(reason[:200])}"
    return url + "#/settings"


@router.get("/status")
def status():
    return github_auth.status()


@router.post("/token")
def connect(body: dict):
    try:
        account = github_auth.connect_token(body.get("token", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # network
        raise HTTPException(502, f"could not verify token: {str(e)[:200]}")
    return {"connected": True, **account}


@router.delete("/token")
def disconnect():
    github_auth.clear_token()
    return github_auth.status()


@router.post("/import-gh")
def import_gh():
    try:
        account = github_auth.import_from_gh()
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"gh import failed: {str(e)[:200]}")
    return {"connected": True, **account}


@router.post("/device/start")
def device_start(s: Session = Depends(session)):
    try:
        return github_auth.device_start(_client_id(s))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"device flow failed: {str(e)[:200]}")


@router.post("/device/poll")
def device_poll(body: dict, s: Session = Depends(session)):
    try:
        return github_auth.device_poll(_client_id(s), body.get("device_code", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"device flow failed: {str(e)[:200]}")


@router.get("/oauth/start")
def oauth_start(request: Request, s: Session = Depends(session)):
    """Begin the OAuth redirect flow: returns the GitHub authorize URL."""
    client_id = _client_id(s)
    if not client_id:
        raise HTTPException(400, "a GitHub OAuth client id is required (Settings, GitHub)")
    if not github_auth.oauth_client_secret():
        raise HTTPException(400, "GITHUB_OAUTH_CLIENT_SECRET is not set")
    base = _base_url(request)
    state = github_auth.make_state()
    url = github_auth.oauth_authorize_url(
        client_id, github_auth.oauth_redirect_uri(base), state
    )
    return {"url": url}


@router.get("/oauth/callback")
def oauth_callback(
    request: Request, code: str = "", state: str = "", s: Session = Depends(session)
):
    """GitHub redirects here; exchange the code and bounce back to the app."""
    base = _base_url(request)
    if not code or not github_auth.verify_state(state):
        return RedirectResponse(_settings_url(base, "error", "invalid or expired state"))
    try:
        github_auth.oauth_exchange(
            _client_id(s),
            github_auth.oauth_client_secret() or "",
            code,
            github_auth.oauth_redirect_uri(base),
        )
    except Exception as e:
        return RedirectResponse(_settings_url(base, "error", str(e)))
    return RedirectResponse(_settings_url(base, "connected"))
