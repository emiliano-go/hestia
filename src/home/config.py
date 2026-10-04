"""Runtime configuration via environment variables."""

import os
from pathlib import Path


def data_dir() -> Path:
    """Root data directory: registry DB, project clones, totem DBs."""
    return Path(os.environ.get("DATA_DIR", "./data")).resolve()


def github_token() -> str | None:
    return os.environ.get("GITHUB_TOKEN") or None


def port() -> int:
    return int(os.environ.get("PORT", "8080"))
