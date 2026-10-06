"""GitHub account connection via personal access token.

Precedence for the token: the GITHUB_TOKEN environment variable wins, then the
token stored from the UI at <DATA_DIR>/github_token (0600). Sign-in options:

- paste a personal access token;
- import the token from the gh CLI (``gh auth token``).
"""

from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path
from shutil import which

import httpx

from hestia import config

GITHUB_API = "https://api.github.com"
GITHUB_WEB = "https://github.com"
_TIMEOUT = 15.0
DEFAULT_SCOPE = "repo"


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
