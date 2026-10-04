"""Totem memory tools: these embed the Totem memory system into the agent."""

from home import totem_store
from home.tools.registry import Registry, Tool, schema


def register(registry: Registry) -> None:
    registry.register(Tool(
        name="memory_search",
        description="Search project memory (Totem) by full-text query.",
        parameters=schema({
            "query": {"type": "string"},
            "limit": {"type": "integer"},
        }, ["query"]),
        handler=lambda ctx, a: totem_store.search(ctx.local_path, a["query"], a.get("limit", 20)),
    ))
    registry.register(Tool(
        name="memory_get",
        description="Fetch a single memory item by id.",
        parameters=schema({"id": {"type": "string"}}, ["id"]),
        handler=lambda ctx, a: totem_store.get(ctx.local_path, a["id"]),
    ))
    registry.register(Tool(
        name="memory_list",
        description="List recent project memories.",
        parameters=schema({"limit": {"type": "integer"}}, []),
        handler=lambda ctx, a: totem_store.list_all(ctx.local_path, a.get("limit", 50)),
    ))
    registry.register(Tool(
        name="memory_create",
        description=(
            "Write a durable project memory. Types: decision, gotcha, observation, "
            "architecture, implementation, open_question, assumption, bug, contract, "
            "constraint, hypothesis, invariant, rejected_idea. Use for decisions made, "
            "facts learned, and anything future sessions should know."
        ),
        parameters=schema({
            "type": {"type": "string"},
            "title": {"type": "string"},
            "statement": {"type": "string", "description": "the durable fact/decision, one paragraph"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "details": {"type": "string"},
            "confidence": {"type": "number"},
            "importance": {"type": "number"},
        }, ["type", "title", "statement", "tags"]),
        handler=lambda ctx, a: totem_store.create(
            ctx.local_path,
            type=a["type"],
            title=a["title"],
            statement=a["statement"],
            tags=a["tags"],
            details=a.get("details"),
            confidence=a.get("confidence", 1.0),
            importance=a.get("importance", 0.5),
        ),
    ))
    registry.register(Tool(
        name="memory_update",
        description="Update an existing memory item (statement, details, title, confidence, importance).",
        parameters=schema({
            "id": {"type": "string"},
            "title": {"type": "string"},
            "statement": {"type": "string"},
            "details": {"type": "string"},
            "reason": {"type": "string", "description": "why this update"},
        }, ["id"]),
        handler=lambda ctx, a: totem_store.update(
            ctx.local_path, a["id"],
            reason=a.get("reason"),
            title=a.get("title"),
            statement=a.get("statement"),
            details=a.get("details"),
        ),
    ))
    registry.register(Tool(
        name="memory_delete",
        description="Soft-delete a memory item with a reason.",
        parameters=schema({
            "id": {"type": "string"},
            "reason": {"type": "string"},
        }, ["id", "reason"]),
        handler=lambda ctx, a: totem_store.delete(ctx.local_path, a["id"], a["reason"]),
    ))
