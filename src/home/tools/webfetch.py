"""Agent tool: fetch a web page (SSRF guarded) as text.

Gated by the `web_fetch_enabled` assistant setting.
"""

from home import settings, webfetch
from home.registry.db import engine
from home.tools.registry import ProjectContext, Registry, Tool, schema

MAX_CHARS = 20_000


def _enabled() -> bool:
    from sqlmodel import Session

    try:
        with Session(engine()) as db:
            return settings.get_bool(db, "web_fetch_enabled", True)
    except Exception:
        return True


def register(registry: Registry) -> None:
    def handler(ctx: ProjectContext, args: dict) -> dict:
        if not _enabled():
            raise ValueError("web fetch is disabled in assistant settings")
        result = webfetch.fetch(args.get("url", ""))
        return {
            "url": result["url"],
            "content_type": result["content_type"],
            "text": result["text"][:MAX_CHARS],
            "truncated": len(result["text"]) > MAX_CHARS,
        }

    registry.register(Tool(
        name="web_fetch",
        description=(
            "Fetch a web page and return its text (no JavaScript rendering). Use it to "
            "read docs, changelogs, or pages the user points at. http/https only."
        ),
        parameters=schema({"url": {"type": "string"}}, ["url"]),
        handler=handler,
        group="web",
    ))
