"""GitHub account connection, gh-style.

Precedence for the token: the GITHUB_TOKEN environment variable wins, then the
token stored from the UI at <DATA_DIR>/github_token (0600). Sign-in options:

- paste a personal access token;
- import the token from the gh CLI (``gh auth token``);
- OAuth device flow, when a client id is configured (Settings, GitHub).

The device flow matches the gh CLI experience: show a code, the user approves
it on github.com, Home polls until the token arrives.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import stat
import subprocess
import time
from pathlib import Path
from shutil import which
from urllib.parse import urlencode

import httpx

from home import config

GITHUB_API = "https://api.github.com"
GITHUB_WEB = "https://github.com"
_TIMEOUT = 15.0
DEFAULT_SCOPE = "repo"
OAUTH_STATE_TTL = 600


def _token_path() -> Path:
    return config.data_dir() / "github_token"


def load_token() -> str | None:
    path = _token_path()
    if not path.exists():
        return None
    token = path.read_text(encoding="utf-8").strip()
    return token or None


def save_token(token: str) -> None:
    token = (token or "").strip()
    if not token:
        raise ValueError("token is required")
    path = _token_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(token, encoding="utf-8")
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass  # best effort; some filesystems ignore chmod


def clear_token() -> None:
    _token_path().unlink(missing_ok=True)


def _headers(token: str) -> dict:
    return {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Authorization": f"Bearer {token}",
    }


def fetch_account(token: str) -> dict:
    resp = httpx.get(f"{GITHUB_API}/user", headers=_headers(token), timeout=_TIMEOUT)
    if resp.status_code == 401:
        raise ValueError("GitHub rejected the token (401)")
    resp.raise_for_status()
    data = resp.json()
    scopes = [
        scope.strip()
        for scope in (resp.headers.get("x-oauth-scopes") or "").split(",")
        if scope.strip()
    ]
    return {
        "login": data.get("login"),
        "name": data.get("name"),
        "avatar_url": data.get("avatar_url"),
        "scopes": scopes,
    }


def gh_cli_available() -> bool:
    return which("gh") is not None


def status() -> dict:
    env_token = os.environ.get("GITHUB_TOKEN") or None
    file_token = load_token()
    token = env_token or file_token
    out = {
        "connected": bool(token),
        "source": "env" if env_token else ("stored" if file_token else None),
        "login": None,
        "name": None,
        "avatar_url": None,
        "scopes": [],
        "gh_cli": gh_cli_available(),
    }
    if token:
        try:
            out.update(fetch_account(token))
        except Exception as e:  # network, bad token, rate limit
            out["error"] = str(e)[:200]
    return out


def connect_token(token: str) -> dict:
    account = fetch_account(token)  # validate before storing
    save_token(token)
    return account


def import_from_gh() -> dict:
    if not gh_cli_available():
        raise ValueError("gh CLI is not installed")
    result = subprocess.run(
        ["gh", "auth", "token"], capture_output=True, text=True, timeout=15
    )
    token = (result.stdout or "").strip()
    if result.returncode != 0 or not token:
        raise ValueError("gh CLI is not logged in (run: gh auth login)")
    return connect_token(token)


def device_start(client_id: str, scope: str = DEFAULT_SCOPE) -> dict:
    client_id = (client_id or "").strip()
    if not client_id:
        raise ValueError("a GitHub OAuth client id is required for device sign-in")
    resp = httpx.post(
        f"{GITHUB_WEB}/login/device/code",
        data={"client_id": client_id, "scope": scope},
        headers={"Accept": "application/json"},
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("device_code"):
        raise ValueError(data.get("error_description") or "device flow failed")
    return {
        "user_code": data.get("user_code"),
        "verification_uri": data.get("verification_uri"),
        "device_code": data.get("device_code"),
        "interval": int(data.get("interval") or 5),
        "expires_in": int(data.get("expires_in") or 900),
    }


def device_poll(client_id: str, device_code: str) -> dict:
    resp = httpx.post(
        f"{GITHUB_WEB}/login/oauth/access_token",
        data={
            "client_id": (client_id or "").strip(),
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        },
        headers={"Accept": "application/json"},
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("access_token"):
        account = connect_token(data["access_token"])
        return {"status": "connected", **account}
    error = data.get("error") or "device flow failed"
    if error in ("authorization_pending", "slow_down"):
        return {"status": error}
    raise ValueError(data.get("error_description") or error)


# --------------------------------------------------------------------------
# OAuth authorization-code (redirect) flow
# --------------------------------------------------------------------------

def oauth_client_secret() -> str | None:
    """The OAuth app secret comes from the environment; never stored in the DB."""
    return os.environ.get("GITHUB_OAUTH_CLIENT_SECRET") or None


def oauth_redirect_uri(base: str) -> str:
    return f"{(base or '').rstrip('/')}/api/github/oauth/callback"


def _state_secret() -> bytes:
    from home import auth  # persisted random secret; avoids a new file

    return auth._secret()


def make_state(ttl: int = OAUTH_STATE_TTL) -> str:
    """Stateless, signed, expiring CSRF state for the OAuth redirect."""
    payload = f"{int(time.time()) + ttl}.{secrets.token_urlsafe(16)}"
    sig = hmac.new(_state_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_state(state: str) -> bool:
    if not state or state.count(".") != 2:
        return False
    payload, _, sig = state.rpartition(".")
    expected = hmac.new(_state_secret(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return False
    expires, _, _ = payload.partition(".")
    try:
        return int(expires) > time.time()
    except ValueError:
        return False


def oauth_authorize_url(
    client_id: str, redirect_uri: str, state: str, scope: str = DEFAULT_SCOPE
) -> str:
    query = urlencode(
        {
            "client_id": (client_id or "").strip(),
            "redirect_uri": redirect_uri,
            "scope": scope,
            "state": state,
        }
    )
    return f"{GITHUB_WEB}/login/oauth/authorize?{query}"


def oauth_exchange(
    client_id: str, client_secret: str, code: str, redirect_uri: str
) -> dict:
    resp = httpx.post(
        f"{GITHUB_WEB}/login/oauth/access_token",
        data={
            "client_id": (client_id or "").strip(),
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        },
        headers={"Accept": "application/json"},
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise ValueError(
            data.get("error_description") or data.get("error") or "OAuth exchange failed"
        )
    return connect_token(token)
