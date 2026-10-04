"""Subagent spawning: the main agent can delegate to named agent profiles.

Each AgentConfig has its own provider (any OpenAI-compatible model), system
prompt, and tool subset, so cheap models can run exploration while the main
agent reasons with a stronger one. Subagents never get the agents tool group,
so they cannot spawn further subagents.
"""

import asyncio

from sqlmodel import Session, select

from home.agent import loop as agent_loop
from home.agent.prompt import POLICY
from home.providers.base import OpenAIClient, resolve_api_key
from home.registry.models import AgentConfig, Provider
from home.tools import build_registry
from home.tools.registry import ProjectContext, Registry, Tool, schema

SUBAGENT_PROMPT = """\
You are a subagent of a project cockpit agent. Complete the task below and
return a concise, self-contained summary of your findings (plain text, no
questions back).

## Policy
""" + POLICY


def make_tools(db: Session) -> list[Tool]:
    def run_handler(ctx: ProjectContext, args: dict) -> dict:
        config = db.exec(select(AgentConfig).where(AgentConfig.name == args["agent"])).first()
        if config is None:
            raise ValueError(f"unknown agent profile: {args['agent']}")
        provider = db.get(Provider, config.provider_id)
        if provider is None:
            raise ValueError(f"agent profile '{config.name}' has no valid provider")
        client = OpenAIClient(
            provider.base_url, resolve_api_key(provider.api_key_env), provider.model
        )
        groups = [g.strip() for g in config.tools.split(",") if g.strip()]
        registry = build_registry().filtered(groups)
        messages = [
            {
                "role": "system",
                "content": f"{SUBAGENT_PROMPT}\n\n## Agent instructions\n{config.system_prompt}",
            },
            {"role": "user", "content": args["task"]},
        ]
        return asyncio.run(_run_subagent(ctx, client, registry, messages, config.max_turns))

    def list_handler(ctx: ProjectContext, args: dict) -> list[dict]:
        configs = db.exec(select(AgentConfig)).all()
        return [
            {
                "name": c.name,
                "tools": c.tools,
                "max_turns": c.max_turns,
                "provider_id": c.provider_id,
            }
            for c in configs
        ]

    return [
        Tool(
            name="run_subagent",
            description=(
                "Delegate a read-only subtask to a named agent profile (a different "
                "model with its own prompt and tool subset). Use for exploration, "
                "GitHub scanning, or memory review. Returns the subagent's summary."
            ),
            parameters=schema({
                "agent": {"type": "string", "description": "agent profile name (see agent_list)"},
                "task": {"type": "string", "description": "self-contained task for the subagent"},
            }, ["agent", "task"]),
            handler=run_handler,
            group="agents",
        ),
        Tool(
            name="agent_list",
            description="List available subagent profiles (name, tool groups, provider).",
            parameters=schema({"properties": {}, "required": []}, []),
            handler=list_handler,
            group="agents",
        ),
    ]


async def _run_subagent(ctx, client, registry, messages, max_turns) -> dict:
    final = ""
    async for event in agent_loop.run_turn(ctx, client, registry, messages, max_turns=max_turns):
        if event["type"] == "message":
            final = event.get("content", "")
        if event["type"] == "error":
            return {"error": event["message"]}
    return {"summary": final}
