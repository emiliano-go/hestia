"""Mutating git tools, gated behind ``Project.allow_git_writes``.

These are registered into a project's agent registry only when the owner
explicitly opts in. All paths are sandboxed to the clone and ``.git`` is off
limits. Commits are authored as "Hestia Agent"; pushes to GitHub use
``GITHUB_TOKEN`` when present.
"""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from sqlmodel import Session, select

from hestia import config, overview
from hestia.tools.registry import ProjectContext, Registry, Tool, schema

GITHUB_API = "https://api.github.com"
_MAX_WRITE_BYTES = 1_000_000

_AUTHOR = [
    "-c",
    "user.name=Hestia Agent",
    "-c",
    "user.email=hestia@localhost",
    "-c",
    "commit.gpgsign=false",  # agent commits are unsigned; no GPG agent headless
]


def _git(ctx: ProjectContext, args: list[str], timeout: int = 120, extra: list[str] | None = None) -> str:
    result = subprocess.run(
        ["git", *(extra or []), *args],
        cwd=ctx.local_path,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip()[:2000] or "git command failed")
    return result.stdout.strip()


def _resolve(ctx: ProjectContext, rel: str) -> Path:
    root = ctx.local_path.resolve()
    path = (root / rel).resolve()
    if path != root and not str(path).startswith(str(root) + os.sep):
        raise PermissionError(f"path escapes the repository: {rel}")
    parts = path.relative_to(root).parts
    if ".git" in parts or ".totem" in parts:
        raise PermissionError("refusing to touch Hestia's metadata (.git, .totem)")
    return path


def _write_file(ctx: ProjectContext, args: dict) -> dict:
    rel = (args.get("path") or "").strip()
    if not rel:
        raise ValueError("path is required")
    content = args.get("content") or ""
    if len(content.encode("utf-8")) > _MAX_WRITE_BYTES:
        raise ValueError(f"content exceeds {_MAX_WRITE_BYTES} bytes")
    path = _resolve(ctx, rel)
    if path.is_dir():
        raise ValueError(f"path is a directory: {rel}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return {"path": str(path.relative_to(ctx.local_path.resolve())), "bytes": len(content.encode("utf-8"))}


def _create_branch(ctx: ProjectContext, args: dict) -> dict:
    name = (args.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    check = subprocess.run(
        ["git", "check-ref-format", "--branch", name],
        cwd=ctx.local_path,
        capture_output=True,
        text=True,
    )
    if check.returncode != 0:
        raise ValueError(f"invalid branch name: {name}")
    _git(ctx, ["checkout", "-b", name])
    return {"branch": name}


def _commit(ctx: ProjectContext, args: dict) -> dict:
    message = (args.get("message") or "").strip()
    if not message:
        raise ValueError("message is required")
    paths = args.get("paths") or []
    if paths:
        resolved = [str(_resolve(ctx, p).relative_to(ctx.local_path.resolve())) for p in paths]
        _git(ctx, ["add", "--", *resolved])
    else:
        _git(ctx, ["add", "-A", "--", ".", ":!.totem"])
    staged = _git(ctx, ["diff", "--cached", "--name-only"])
    if not staged:
        raise ValueError("nothing to commit")
    _git(ctx, ["commit", "-m", message], extra=_AUTHOR)
    return {
        "sha": _git(ctx, ["rev-parse", "HEAD"]),
        "summary": _git(ctx, ["log", "-1", "--oneline"]),
        "files": staged.splitlines(),
    }


def _require_approval(db, ctx: ProjectContext, action: str) -> None:
    """Hard gate for opted-in projects: a fresh approved request is required.

    # ponytail: one approval covers a 30 minute window and any number of calls
    in it; per-call consumption if that ever matters.
    """
    if db is None:
        return
    from hestia.registry.models import Project, Question

    project = db.get(Project, ctx.project_id)
    if project is None or not project.require_write_approval:
        return
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    rows = db.exec(
        select(Question)
        .where(
            Question.project_id == ctx.project_id,
            Question.kind == "approval",
            Question.status == "answered",
        )
        .order_by(Question.id.desc())
    ).all()
    for question in rows:
        try:
            meta = json.loads(question.meta or "{}")
        except ValueError:
            meta = {}
        if meta.get("action") != action:
            continue
        if (question.answer or "").strip().lower() not in ("approve", "approved"):
            continue
        answered = question.answered_at or question.created_at
        if answered is None:
            continue
        if answered.tzinfo is None:
            answered = answered.replace(tzinfo=timezone.utc)
        if answered >= cutoff:
            return
    raise PermissionError(
        f"{action} requires your approval first: call ask_approval and wait for the answer"
    )


def _push(ctx: ProjectContext, args: dict, db: Session | None = None) -> dict:
    _require_approval(db, ctx, "git_push")
    branch = (args.get("branch") or "").strip() or _git(ctx, ["rev-parse", "--abbrev-ref", "HEAD"])
    extra: list[str] = []
    token = config.github_token()
    if token and "github.com" in (ctx.repo_url or ""):
        extra = ["-c", f"http.extraheader=Authorization: Bearer {token}"]
    output = _git(ctx, ["push", "-u", "origin", branch], extra=extra, timeout=300)
    return {"branch": branch, "output": output[-2000:]}


def _gh_headers() -> dict:
    token = config.github_token()
    if not token:
        raise PermissionError("GITHUB_TOKEN is required for GitHub API writes")
    return {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Authorization": f"Bearer {token}",
    }


def _default_branch(slug: str) -> str:
    resp = httpx.get(f"{GITHUB_API}/repos/{slug}", headers=_gh_headers(), timeout=15)
    resp.raise_for_status()
    return resp.json().get("default_branch") or "main"


def _create_pr(slug: str, payload: dict) -> dict:
    resp = httpx.post(
        f"{GITHUB_API}/repos/{slug}/pulls", headers=_gh_headers(), json=payload, timeout=30
    )
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"GitHub {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def _open_pr(ctx: ProjectContext, args: dict, db: Session | None = None) -> dict:
    _require_approval(db, ctx, "gh_open_pr")
    slug = overview.repo_slug(ctx.repo_url)
    if not slug:
        raise ValueError("project is not a GitHub repository")
    title = (args.get("title") or "").strip()
    if not title:
        raise ValueError("title is required")
    head = _git(ctx, ["rev-parse", "--abbrev-ref", "HEAD"])
    base = (args.get("base") or "").strip() or _default_branch(slug)
    pr = _create_pr(
        slug,
        {"title": title, "body": args.get("body") or "", "head": head, "base": base},
    )
    return {"number": pr.get("number"), "url": pr.get("html_url"), "head": head, "base": base}


def register(registry: Registry, db: Session | None = None) -> None:
    registry.register(Tool(
        name="write_file",
        description=(
            "Create or overwrite a file in the repository clone (git writes are "
            "enabled for this project). Never writes inside .git."
        ),
        parameters=schema({
            "path": {"type": "string", "description": "path relative to the clone root"},
            "content": {"type": "string", "description": "full file content"},
        }, ["path", "content"]),
        handler=_write_file,
        group="writes",
    ))
    registry.register(Tool(
        name="git_create_branch",
        description="Create and switch to a new branch in the clone.",
        parameters=schema({"name": {"type": "string"}}, ["name"]),
        handler=_create_branch,
        group="writes",
    ))
    registry.register(Tool(
        name="git_commit",
        description="Stage changes (all, or the given paths) and commit them.",
        parameters=schema({
            "message": {"type": "string"},
            "paths": {"type": "array", "items": {"type": "string"}},
        }, ["message"]),
        handler=_commit,
        group="writes",
    ))
    registry.register(Tool(
        name="git_push",
        description="Push a branch to origin (uses GITHUB_TOKEN for GitHub remotes).",
        parameters=schema({"branch": {"type": "string"}}, []),
        handler=lambda ctx, a: _push(ctx, a, db),
        group="writes",
    ))
    registry.register(Tool(
        name="gh_open_pr",
        description="Open a pull request on GitHub from the current branch.",
        parameters=schema({
            "title": {"type": "string"},
            "body": {"type": "string"},
            "base": {"type": "string", "description": "base branch (default: repo default)"},
        }, ["title"]),
        handler=lambda ctx, a: _open_pr(ctx, a, db),
        group="writes",
    ))
