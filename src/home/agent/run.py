"""One-shot agent runs (docs, scheduled jobs): no chat session, just a prompt.

Triage and the memory fixer predate this and keep their own copies; new
server-side jobs share this helper.
"""

from sqlmodel import Session

from home import usage
from home.agent import loop as agent_loop
from home.providers.base import OpenAIClient, resolve_api_key
from home.tools import build_registry
from home.tools import tasks as task_tools
from home.tools.registry import ProjectContext


async def run_once(
    project,
    provider,
    system: str,
    user: str,
    groups: str = "",
    max_turns: int = 8,
    tasks_db: Session | None = None,
    writes: bool = False,
) -> tuple[str, str | None, dict]:
    """Run one agent turn to completion.

    Returns ``(final_text, error, token_usage)``.
    """
    ctx = ProjectContext.from_project(project)
    registry = build_registry(writes=writes)
    wanted = [g for g in (groups or "").split(",") if g]
    if wanted:
        registry = registry.filtered(wanted)
    if tasks_db is not None:
        from home.tools import jobs as job_tools
        from home.tools import preferences as pref_tools
        from home.tools import reminders as reminder_tools
        from home.tools import schedules as schedule_tools
        from home.tools import watches as watch_tools

        builders = {
            "tasks": task_tools.make_tools,
            "reminders": reminder_tools.make_tools,
            "watches": watch_tools.make_tools,
            "background": job_tools.make_tools,
            "automations": schedule_tools.make_tools,
            "memory": pref_tools.make_tools,
        }
        for group, builder in builders.items():
            if group in wanted:
                for tool in builder(tasks_db):
                    registry.register(tool)
    client = OpenAIClient(
        provider.base_url, resolve_api_key(provider), provider.model
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    final = ""
    tokens: dict = {}
    async for event in agent_loop.run_turn(
        ctx, client, registry, messages, max_turns=max_turns
    ):
        if event["type"] == "usage":
            usage.merge(tokens, event.get("usage"))
            continue
        if event["type"] == "message":
            final = event.get("content", "")
        elif event["type"] == "error":
            return final, event["message"], tokens
    return final, None, tokens
