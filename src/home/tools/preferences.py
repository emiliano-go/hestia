"""Agent tool for durable global preferences.

Global preferences are injected into every system prompt (see
``settings.prompt_context``), unlike project memory which is retrieved by
relevance. Use this for rules the agent must never forget, such as a house
writing style.
"""

from sqlmodel import Session

from home import settings
from home.tools.registry import ProjectContext, Tool, schema


def make_tools(db: Session) -> list[Tool]:
    def remember_handler(ctx: ProjectContext, args: dict) -> dict:
        text = (args.get("text") or "").strip()
        if not text:
            raise ValueError("text is required")
        return {"preferences": settings.add_preference(db, text)}

    def list_handler(ctx: ProjectContext, args: dict) -> dict:
        return {"preferences": settings.preferences(db)}

    return [
        Tool(
            name="remember_preference",
            description=(
                "Save a durable global preference that is injected into every "
                "future prompt (for example a writing style or a rule the owner "
                "wants followed always). Use when the owner says to remember a "
                "rule. Preferences are global, not per project."
            ),
            parameters=schema(
                {"text": {"type": "string", "description": "the rule, one sentence"}},
                ["text"],
            ),
            handler=remember_handler,
            group="memory",
        ),
        Tool(
            name="list_preferences",
            description="List the durable global preferences currently in effect.",
            parameters=schema({}, []),
            handler=list_handler,
            group="memory",
        ),
    ]
