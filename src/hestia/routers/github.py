"""GitHub account connection: status, token, gh import."""

from fastapi import APIRouter, HTTPException

from hestia import github_auth

router = APIRouter(prefix="/api/github", tags=["github"])


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
