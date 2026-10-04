"""Tool-calling agent loop with SSE event streaming.

Yields event dicts:
    {"type": "token", "text": ...}
    {"type": "tool_call", "name": ..., "arguments": ...}
    {"type": "tool_result", "name": ..., "ok": bool, "preview": str}
    {"type": "message", "content": ..., "tool_calls": [...]}
    {"type": "error", "message": ...}
"""

import json
from typing import Any, AsyncIterator

from home.providers.base import OpenAIClient
from home.tools.registry import ProjectContext, Registry

MAX_TURNS = 10


async def run_turn(
    ctx: ProjectContext,
    client: OpenAIClient,
    registry: Registry,
    messages: list[dict[str, Any]],
) -> AsyncIterator[dict[str, Any]]:
    tools = registry.openai_schemas()
    try:
        for _ in range(MAX_TURNS):
            content, tool_calls = await _accumulate(client, messages, tools)
            yield {"type": "message", "content": content, "tool_calls": tool_calls}
            if not tool_calls:
                return
            messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})
            for call in tool_calls:
                name = call["function"]["name"]
                args = json.loads(call["function"].get("arguments") or "{}")
                yield {"type": "tool_call", "name": name, "arguments": args}
                ok, result = _execute(registry, ctx, name, args)
                preview = json.dumps(result, default=str)[:2000]
                yield {"type": "tool_result", "name": name, "ok": ok, "preview": preview}
                messages.append({
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "name": name,
                    "content": json.dumps(result, default=str)[:20_000],
                })
        yield {"type": "error", "message": f"stopped after {MAX_TURNS} tool-call turns"}
    except Exception as e:
        yield {"type": "error", "message": str(e)[:1000]}


async def _accumulate(
    client: OpenAIClient,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """Consume one provider turn into full text + normalized tool calls."""
    content_parts: list[str] = []
    calls: dict[int, dict[str, Any]] = {}
    async for chunk in client.stream_chat(messages, tools=tools):
        choice = (chunk.get("choices") or [{}])[0]
        delta = choice.get("delta") or {}
        if delta.get("content"):
            content_parts.append(delta["content"])
        for dtc in delta.get("tool_calls") or []:
            idx = dtc.get("index", 0)
            call = calls.setdefault(idx, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
            if dtc.get("id"):
                call["id"] = dtc["id"]
            fn = dtc.get("function") or {}
            if fn.get("name"):
                call["function"]["name"] += fn["name"]
            if fn.get("arguments"):
                call["function"]["arguments"] += fn["arguments"]
    return "".join(content_parts), [calls[i] for i in sorted(calls)]


def _execute(registry: Registry, ctx: ProjectContext, name: str, args: dict[str, Any]) -> tuple[bool, Any]:
    tool = registry.get(name)
    if tool is None:
        return False, f"unknown tool: {name}"
    try:
        return True, tool.handler(ctx, args)
    except PermissionError as e:
        return False, f"blocked by sandbox: {e}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
