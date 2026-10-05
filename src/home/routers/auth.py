"""Auth endpoints: passkey registration (setup token) and login."""

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlmodel import Session

from home import auth
from home.registry.db import session

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _require_enabled() -> None:
    if not auth.enabled():
        raise HTTPException(400, "authentication is disabled (set HOME_SETUP_TOKEN)")


@router.get("/status")
def status(request: Request, s: Session = Depends(session)):
    enabled = auth.enabled()
    return {
        "enabled": enabled,
        "authenticated": (not enabled)
        or auth.verify_session(request.cookies.get(auth.SESSION_COOKIE)),
        "has_passkeys": auth.has_passkeys(s),
        "rp_id": request.url.hostname,
    }


@router.post("/register/begin")
def register_begin(body: dict, request: Request, s: Session = Depends(session)):
    _require_enabled()
    if not auth.check_setup_token(body.get("setup_token")):
        raise HTTPException(403, "invalid setup token")
    return auth.register_begin(s, request)


@router.post("/register/complete")
def register_complete(body: dict, request: Request, s: Session = Depends(session)):
    _require_enabled()
    if not auth.check_setup_token(body.get("setup_token")):
        raise HTTPException(403, "invalid setup token")
    try:
        passkey = auth.register_complete(
            s, request, body.get("ceremony"), body.get("credential") or {}
        )
    except Exception as e:  # bad attestation, expired ceremony, malformed response
        raise HTTPException(400, f"registration failed: {str(e)[:200]}")
    response = JSONResponse({"ok": True, "credential_id": passkey.credential_id})
    _set_session(response, request)
    return response


@router.post("/login/begin")
def login_begin(request: Request, s: Session = Depends(session)):
    _require_enabled()
    try:
        return auth.login_begin(s, request)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/login/complete")
def login_complete(body: dict, request: Request, s: Session = Depends(session)):
    _require_enabled()
    try:
        auth.login_complete(s, request, body.get("ceremony"), body.get("credential") or {})
    except Exception as e:  # failed assertion, expired ceremony, malformed response
        raise HTTPException(401, f"login failed: {str(e)[:200]}")
    response = JSONResponse({"ok": True})
    _set_session(response, request)
    return response


@router.post("/logout")
def logout(request: Request):
    response = JSONResponse({"ok": True})
    response.delete_cookie(auth.SESSION_COOKIE)
    return response


def _set_session(response: JSONResponse, request: Request) -> None:
    response.set_cookie(
        auth.SESSION_COOKIE,
        auth.make_session(),
        max_age=auth.SESSION_TTL,
        httponly=True,
        samesite="lax",
        secure=auth.cookie_secure(request.url.scheme),
    )
