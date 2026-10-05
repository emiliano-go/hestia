"""GitHub account connection: status, token, gh import, device flow."""

import os

from fastapi import APIRouter, Depends, HTTPException
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
