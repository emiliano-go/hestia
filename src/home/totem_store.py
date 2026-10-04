"""Per-project Totem memory access.

Wraps totem_mcp's own connection helpers so we reuse its schema, migrations,
and libSQL FTS handling verbatim. One Totem DB per project clone at
<clone>/.totem/totem.db; all sessions of a project share it, which is what
makes cross-session memory work.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from totem_mcp.context import engineering_context
from totem_mcp.db import db_connection
from totem_mcp.tools import (
    memory_create,
    memory_delete,
    memory_get,
    memory_list,
    memory_recent,
    memory_search,
    memory_update,
)


@contextmanager
def totem(project_dir: Path) -> Iterator:
    """Open a project's Totem DB (schema init + first-use project setup)."""
    with db_connection(project=str(project_dir)) as conn:
        yield conn


def digest(project_dir: Path, task: str, tags: list[str] | None = None) -> dict:
    """Ranked memory context for a task; what bootstraps a sessionless agent."""
    with totem(project_dir) as conn:
        return engineering_context(
            conn,
            tags=tags or [],
            task=task,
            current_task=task,
        )


def search(project_dir: Path, query: str, limit: int = 20) -> list[dict]:
    with totem(project_dir) as conn:
        return memory_search(conn, query, limit=limit)


def get(project_dir: Path, memory_id: str) -> dict | None:
    with totem(project_dir) as conn:
        return memory_get(conn, memory_id)


def list_all(project_dir: Path, limit: int = 100) -> list[dict]:
    with totem(project_dir) as conn:
        return memory_list(conn, limit=limit)


def recent(project_dir: Path, limit: int = 5) -> list[dict]:
    with totem(project_dir) as conn:
        return memory_recent(conn, limit=limit)


def create(
    project_dir: Path,
    type: str,
    title: str,
    statement: str,
    tags: list[str],
    **kwargs,
) -> dict:
    with totem(project_dir) as conn:
        return memory_create(conn, type, title, statement, tags, **kwargs)


def update(project_dir: Path, memory_id: str, **kwargs) -> dict | None:
    with totem(project_dir) as conn:
        item = memory_update(conn, memory_id, **kwargs)
    return item or None


def delete(project_dir: Path, memory_id: str, reason: str) -> dict:
    with totem(project_dir) as conn:
        return memory_delete(conn, memory_id, reason)
