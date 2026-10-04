"""Runtime configuration via environment variables."""

import os
from pathlib import Path


def data_dir() -> Path:
    """Root data directory: registry DB, project clones, totem DBs."""
    return Path(os.environ.get("DATA_DIR", "./data")).resolve()


def github_token() -> str | None:
    return os.environ.get("GITHUB_TOKEN") or None


def slug(name: str) -> str:
    """Filesystem-safe directory name for a project."""
    return "".join(c if c.isalnum() or c in "-_" else "-" for c in name)


def workspace_dir(name: str) -> Path:
    """Per-project workspace for agent-generated files (plans, specs, notes).

    Lives in the data volume next to the clones, so it persists across
    container restarts and is never inside the repository itself.
    """
    path = data_dir() / "workspaces" / slug(name)
    path.mkdir(parents=True, exist_ok=True)
    return path


def port() -> int:
    return int(os.environ.get("PORT", "8080"))
