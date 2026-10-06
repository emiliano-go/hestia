"""Skill tools: load installed skills into the agent's context."""

from hestia import skills
from hestia.tools.registry import Registry, Tool, schema


def _read(ctx, args):
    try:
        return {"name": args["name"], "content": skills.read(args["name"])}
    except skills.InvalidSource as e:
        return {"error": str(e)}


def register(registry: Registry) -> None:
    registry.register(
        Tool(
            name="read_skill",
            description=(
                "Load the full instructions of an installed skill by name. "
                "Installed skills are listed in the system prompt; read the "
                "matching one before doing work it covers."
            ),
            parameters=schema({"name": {"type": "string"}}, ["name"]),
            handler=_read,
            group="skills",
        )
    )
