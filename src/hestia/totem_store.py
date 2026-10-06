"""Per-project Totem memory access.

Wraps totem_mcp's own connection helpers so we reuse its schema, migrations,
and libSQL FTS handling verbatim. One Totem DB per project clone at
<clone>/.totem/totem.db; all sessions of a project share it, which is what
makes cross-session memory work.
"""

import os
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


# Tags that make a user memory always-on (identity, preferences, ...).
USER_TAGS = {
    "identity",
    "preference",
    "habit",
    "communication",
    "standing-instruction",
    "personal-fact",
}


@contextmanager
def totem(project_dir: Path) -> Iterator:
    """Open a project's Totem DB (schema init + first-use project setup)."""
    with db_connection(project=str(project_dir)) as conn:
        yield conn


def _user_db_path() -> Path:
    """Hestia keeps the user DB in its data volume unless told otherwise."""
    from hestia import config

    os.environ.setdefault("TOTEM_USER_DB", str(config.user_memory_path()))
    from totem_mcp.db import get_user_db_path

    return get_user_db_path()


@contextmanager
def user_totem() -> Iterator:
    """Open the global Totem user DB (identity, preferences, habits)."""
    from totem_mcp.db import connect, init_db

    path = _user_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    init_db(conn)
    try:
        yield conn
    finally:
        conn.close()


def user_list(limit: int = 200) -> list[dict]:
    with user_totem() as conn:
        return memory_list(conn, limit=limit)


def user_search(query: str, limit: int = 20) -> list[dict]:
    with user_totem() as conn:
        return memory_search(conn, query, limit=limit)


def user_get(memory_id: str) -> dict | None:
    with user_totem() as conn:
        return memory_get(conn, memory_id)


def user_create(
    type: str, title: str, statement: str, tags: list[str], **kwargs
) -> dict:
    with user_totem() as conn:
        return memory_create(conn, type, title, statement, tags, **kwargs)


def user_update(memory_id: str, **kwargs) -> dict | None:
    with user_totem() as conn:
        item = memory_update(conn, memory_id, **kwargs)
    return item or None


def user_delete(memory_id: str, reason: str) -> dict:
    with user_totem() as conn:
        return memory_delete(conn, memory_id, reason)


def digest(project_dir: Path, task: str, tags: list[str] | None = None) -> dict:
    """Ranked memory context for a task: user memory, then project memory."""
    with totem(project_dir) as conn:
        result = engineering_context(
            conn,
            tags=tags or [],
            task=task,
            current_task=task,
        )
    # Totem already emits USER CONTEXT (from the user DB) and PROJECT CONTEXT
    # sections; Hestia only appends project-level standing notes.
    blocks = []
    context = (result.get("context") or "").strip()
    if context:
        blocks.append(context)
    always = always_on(project_dir)
    if always:
        block = "\n".join(f"- {m['title']}: {m['statement']}" for m in always)
        blocks.append(f"## Standing preferences and client notes\n{block}")
    result["context"] = "\n\n".join(blocks)
    return result


def _tags_of(item: dict) -> list[str]:
    tags = item.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.replace(",", " ").split()]
    return [str(t).lower() for t in tags]


def always_on(project_dir: Path) -> list[dict]:
    """Memories that must be in every prompt: preferences and client facts."""
    out = []
    for item in list_all(project_dir, limit=500):
        tags = _tags_of(item)
        if any(t == "preference" or t == "client" or t.startswith("client:") for t in tags):
            out.append(item)
    return out


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
