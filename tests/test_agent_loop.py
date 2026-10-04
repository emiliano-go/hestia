"""Agent loop test against a fake OpenAI-compatible provider."""

import json

import pytest

from home.agent import loop as agent_loop
from home.providers.base import OpenAIClient
from home.tools import build_registry
from home.tools.registry import ProjectContext


class FakeClient(OpenAIClient):
    """Scripted provider: replies with tool calls first, then a text answer."""

    def __init__(self, script):
        super().__init__("http://fake", None, "fake")
        self.script = list(script)

    async def stream_chat(self, messages, tools=None):
        reply = self.script.pop(0) if self.script else {"content": "done"}
        chunks = []
        if reply.get("tool_calls"):
            for i, tc in enumerate(reply["tool_calls"]):
                chunks.append({"choices": [{"delta": {"tool_calls": [dict(index=i, id=tc["id"], function={"name": tc["name"], "arguments": ""})]}}]})
                chunks.append({"choices": [{"delta": {"tool_calls": [dict(index=i, function={"arguments": tc["arguments"]})]}}]})
        text = reply.get("content", "")
        for word in text.split(" "):
            chunks.append({"choices": [{"delta": {"content": word + " "}}]})
        for chunk in chunks:
            yield chunk


@pytest.fixture
def repo(tmp_path):
    (tmp_path / "AGENTS.md").write_text("# Instructions\nUse sqlite.\n")
    return ProjectContext(project_id=1, name="t", repo_url="https://github.com/a/b", local_path=tmp_path)


@pytest.mark.asyncio
async def test_tool_call_loop(repo):
    client = FakeClient([
        {"tool_calls": [
            {"id": "call_1", "name": "read_agents_md", "arguments": "{}"},
            {"id": "call_2", "name": "memory_create", "arguments": json.dumps({
                "type": "decision", "title": "D", "statement": "S", "tags": ["x"]})},
        ]},
        {"content": "Based on AGENTS.md, the project uses sqlite."},
    ])
    registry = build_registry()
    events = [e async for e in agent_loop.run_turn(repo, client, registry, [{"role": "user", "content": "hi"}])]

    tool_results = [e for e in events if e["type"] == "tool_result"]
    assert [t["name"] for t in tool_results] == ["read_agents_md", "memory_create"]
    assert all(t["ok"] for t in tool_results)
    assert events[-1]["type"] == "message"
    assert "sqlite" in events[-1]["content"]
