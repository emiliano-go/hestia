"""Totem memory tools: these embed the Totem memory system into the agent."""

from hestia import totem_store
from hestia.tools.registry import Registry, Tool, schema


def register(registry: Registry) -> None:
    registry.register(Tool(
        name="memory_search",
        description="Search project memory (Totem) by full-text query.",
        parameters=schema({
            "query": {"type": "string"},
            "limit": {"type": "integer"},
        }, ["query"]),
        handler=lambda ctx, a: totem_store.search(ctx.memory_path, a["query"], a.get("limit", 20)),
        group="memory",
    ))
    registry.register(Tool(
        name="memory_get",
        description="Fetch a single memory item by id.",
        parameters=schema({"id": {"type": "string"}}, ["id"]),
        handler=lambda ctx, a: totem_store.get(ctx.memory_path, a["id"]),
        group="memory",
    ))
    registry.register(Tool(
        name="memory_list",
        description="List recent project memories.",
        parameters=schema({"limit": {"type": "integer"}}, []),
        handler=lambda ctx, a: totem_store.list_all(ctx.memory_path, a.get("limit", 50)),
        group="memory",
    ))
    registry.register(Tool(
        name="memory_create",
        description=(
            "Write a durable project memory. Types: decision, gotcha, observation, "
            "architecture, implementation, open_question, assumption, bug, contract, "
            "constraint, hypothesis, invariant, rejected_idea. Use for decisions made, "
            "facts learned, and anything future sessions should know. Tag a rule the "
            "agent must always follow with 'preference'; tag facts about a client or "
            "person with 'client' and 'client:<name>' so they stay in context."
        ),
        parameters=schema({
            "type": {"type": "string"},
            "title": {"type": "string"},
            "statement": {"type": "string", "description": "the durable fact/decision, one paragraph"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "details": {"type": "string"},
            "confidence": {"type": "number"},
            "importance": {"type": "number"},
            "metadata": {
                "type": "object",
                "description": (
                    "type-specific fields required by some types: observation "
                    "(observation), decision (rationale), invariant "
                    "(verificationMethod), assumption (claimCategory, basis), "
                    "open_question (question, impact, blocking), ambiguity "
                    "(question, interpretations, impact), rejected_idea "
                    "(proposal, reasonRejected), implementation (subject, kind, path)"
                ),
            },
        }, ["type", "title", "statement", "tags"]),
        handler=lambda ctx, a: totem_store.create(
            ctx.memory_path,
            type=a["type"],
            title=a["title"],
            statement=a["statement"],
            tags=a["tags"],
            details=a.get("details"),
            confidence=a.get("confidence", 1.0),
            importance=a.get("importance", 0.5),
            metadata=a.get("metadata"),
        ),
        group="memory",
        effect="write",
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
            ctx.memory_path, a["id"],
            reason=a.get("reason"),
            title=a.get("title"),
            statement=a.get("statement"),
            details=a.get("details"),
        ),
        group="memory",
        effect="write",
    ))
    registry.register(Tool(
        name="memory_delete",
        description="Soft-delete a memory item with a reason.",
        parameters=schema({
            "id": {"type": "string"},
            "reason": {"type": "string"},
        }, ["id", "reason"]),
        handler=lambda ctx, a: totem_store.delete(ctx.memory_path, a["id"], a["reason"]),
        group="memory",
        effect="write",
    ))
