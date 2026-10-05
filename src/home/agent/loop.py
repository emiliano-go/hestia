"""Tool-calling agent loop with SSE event streaming.

Yields event dicts:
    {"type": "token", "text": ...}
    {"type": "tool_call", "name": ..., "arguments": ...}
    {"type": "tool_result", "name": ..., "ok": bool, "preview": str}
    {"type": "message", "content": ..., "tool_calls": [...]}
    {"type": "question", ...} (from AgentPause tools)
    {"type": "error", "message": ...}
"""

import json
from typing import Any, AsyncIterator

from home.providers.base import OpenAIClient
from home.tools.registry import ProjectContext, Registry

MAX_TURNS = 10


class AgentPause(Exception):
    """Raised by a tool to end the turn and wait for the user (e.g. ask_user).

    ``payload`` is forwarded as a ``question`` event by ``run_turn``.
    """

    def __init__(self, payload: dict[str, Any]):
        super().__init__("agent paused")
        self.payload = payload


async def run_turn(
    ctx: ProjectContext,
    client: OpenAIClient,
    registry: Registry,
    messages: list[dict[str, Any]],
    max_turns: int = MAX_TURNS,
) -> AsyncIterator[dict[str, Any]]:
    tools = registry.openai_schemas()
    try:
        for _ in range(max_turns):
            turn: dict[str, Any] = {}
            async for event in _stream_turn(client, messages, tools):
                if event["type"] == "_turn":
                    turn = event
                else:
                    yield event
            content = turn.get("content", "")
            tool_calls = turn.get("tool_calls", [])
            usage = turn.get("usage")
            if usage:
                yield {"type": "usage", "usage": usage}
            yield {"type": "message", "content": content, "tool_calls": tool_calls}
            if not tool_calls:
                return
            messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})
            for call in tool_calls:
                name = call["function"]["name"]
                args = json.loads(call["function"].get("arguments") or "{}")
                yield {"type": "tool_call", "id": call["id"], "name": name, "arguments": args}
                try:
                    ok, result = _execute(registry, ctx, name, args)
                except AgentPause as pause:
                    yield {"type": "question", **pause.payload}
                    return
                preview = json.dumps(result, default=str)[:2000]
                yield {
                    "type": "tool_result",
                    "id": call["id"],
                    "name": name,
                    "ok": ok,
                    "preview": preview,
                }
                messages.append({
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "name": name,
                    "content": json.dumps(result, default=str)[:20_000],
                })
        yield {"type": "error", "message": f"stopped after {max_turns} tool-call turns"}
    except Exception as e:
        yield {"type": "error", "message": str(e)[:1000]}


async def _stream_turn(
    client: OpenAIClient,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
) -> AsyncIterator[dict[str, Any]]:
    """Stream one provider turn: token events, then a final ``_turn`` dict."""
    content_parts: list[str] = []
    calls: dict[int, dict[str, Any]] = {}
    usage: dict[str, Any] | None = None
    async for chunk in client.stream_chat(messages, tools=tools):
        if chunk.get("usage"):
            usage = chunk["usage"]
        choice = (chunk.get("choices") or [{}])[0]
        delta = choice.get("delta") or {}
        if delta.get("content"):
            content_parts.append(delta["content"])
            yield {"type": "token", "text": delta["content"]}
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
    yield {
        "type": "_turn",
        "content": "".join(content_parts),
        "tool_calls": [calls[i] for i in sorted(calls)],
        "usage": usage,
    }


def _execute(registry: Registry, ctx: ProjectContext, name: str, args: dict[str, Any]) -> tuple[bool, Any]:
    tool = registry.get(name)
    if tool is None:
        return False, f"unknown tool: {name}"
    try:
        return True, tool.handler(ctx, args)
    except AgentPause:
        raise  # ends the turn; handled by run_turn
    except PermissionError as e:
        return False, f"blocked by sandbox: {e}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
