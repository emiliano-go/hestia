"""GitHub REST tools (read-only): commits, PRs, issues, CI runs."""

import os

import httpx

from home import config
from home.tools.registry import ProjectContext, Registry, Tool, schema

_API = "https://api.github.com"


def _repo_slug(ctx: ProjectContext) -> str | None:
    """Extract owner/repo from a GitHub remote URL, or None."""
    url = ctx.repo_url.removesuffix(".git")
    if "github.com" not in url:
        return None
    parts = url.split("github.com")[-1].strip("/").split("/")
    return "/".join(parts[-2:]) if len(parts) >= 2 else None


def _get(ctx: ProjectContext, path: str, params: dict | None = None) -> dict | list:
    slug = _repo_slug(ctx)
    if not slug:
        raise ValueError("project repo_url is not a GitHub URL")
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token := config.github_token():
        headers["Authorization"] = f"Bearer {token}"
    resp = httpx.get(f"{_API}/repos/{slug}{path}", headers=headers, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def register(registry: Registry) -> None:
    registry.register(Tool(
        name="gh_commits",
        description="Recent commits on the default branch (GitHub API).",
        parameters=schema({"per_page": {"type": "integer"}}, []),
        handler=lambda ctx, a: _get(ctx, "/commits", {"per_page": a.get("per_page", 20)}),
    ))
    registry.register(Tool(
        name="gh_prs",
        description="List pull requests (state: open, closed, all).",
        parameters=schema({
            "state": {"type": "string", "enum": ["open", "closed", "all"]},
            "per_page": {"type": "integer"},
        }, []),
        handler=lambda ctx, a: _get(ctx, "/pulls", {"state": a.get("state", "open"), "per_page": a.get("per_page", 20)}),
    ))
    registry.register(Tool(
        name="gh_issues",
        description="List issues (state: open, closed, all).",
        parameters=schema({
            "state": {"type": "string", "enum": ["open", "closed", "all"]},
            "per_page": {"type": "integer"},
        }, []),
        handler=lambda ctx, a: _get(ctx, "/issues", {"state": a.get("state", "open"), "per_page": a.get("per_page", 20)}),
    ))
    registry.register(Tool(
        name="gh_ci_runs",
        description="Recent GitHub Actions workflow runs.",
        parameters=schema({"per_page": {"type": "integer"}}, []),
        handler=lambda ctx, a: _get(ctx, "/actions/runs", {"per_page": a.get("per_page", 20)}),
    ))
