"""Subagent delegation: main agent spawns a profile with its own fake model."""

import os

from sqlmodel import Session

from hestia.registry.db import engine, init_db
from hestia.registry.models import AgentConfig, Provider
from hestia.tools.registry import ProjectContext
from hestia.tools import subagents
from tests.test_agent_loop import FakeClient


def test_run_subagent_with_profile(tmp_path, monkeypatch):
    os.environ["DATA_DIR"] = str(tmp_path / "data")
    init_db()

    scripted = [
        {"tool_calls": [{"id": "c1", "name": "read_agents_md", "arguments": "{}"}]},
        {"content": "Findings: use sqlite."},
    ]

    def fake_client(base_url, api_key, model, **kwargs):
        return FakeClient(scripted)

    monkeypatch.setattr(subagents, "OpenAIClient", fake_client)

    with Session(engine()) as s:
        provider = Provider(name="fake", base_url="http://x", api_key_env="NOPE", model="m")
        s.add(provider)
        s.commit()
        s.refresh(provider)
        s.add(AgentConfig(
            name="explore",
            system_prompt="Explore things.",
            provider_id=provider.id,
            tools="repo,files",
            max_turns=4,
        ))
        s.commit()

        tools = {t.name: t for t in subagents.make_tools(s)}
        ctx = ProjectContext(project_id=1, name="t", repo_url="", local_path=tmp_path)
        (tmp_path / "AGENTS.md").write_text("# x\n")

        listing = tools["agent_list"].handler(ctx, {})
        assert listing[0]["name"] == "explore"

        result = tools["run_subagent"].handler(ctx, {"agent": "explore", "task": "inspect"})
        assert result["summary"].strip() == "Findings: use sqlite."


def test_run_subagent_inside_running_loop(tmp_path, monkeypatch):
    """The tool is called from the parent's running event loop; it must not use
    asyncio.run on that loop (regression: RuntimeError, delegation was dead)."""
    import asyncio

    os.environ["DATA_DIR"] = str(tmp_path / "data")
    init_db()

    async def fake_run_turn(ctx, client, registry, messages, max_turns=10):
        yield {"type": "message", "content": "subagent done", "tool_calls": []}

    monkeypatch.setattr(subagents.agent_loop, "run_turn", fake_run_turn)

    def fake_client(base_url, api_key, model, **kwargs):
        return FakeClient([])

    monkeypatch.setattr(subagents, "OpenAIClient", fake_client)

    with Session(engine()) as s:
        provider = Provider(name="fake2", base_url="http://x", api_key_env="NOPE", model="m")
        s.add(provider)
        s.commit()
        s.refresh(provider)
        s.add(AgentConfig(name="explore2", provider_id=provider.id, tools="repo", max_turns=2))
        s.commit()

        tools = {t.name: t for t in subagents.make_tools(s)}
        ctx = ProjectContext(project_id=1, name="t", repo_url="", local_path=tmp_path)

        async def call_from_loop():
            return tools["run_subagent"].handler(ctx, {"agent": "explore2", "task": "inspect"})

        result = asyncio.run(call_from_loop())
        assert result["summary"] == "subagent done"


def test_subagent_action_uses_assigned_agent_model(tmp_path, monkeypatch):
    """Assigning an agent (hence a model) to an action must be honored, with a
    fallback to the chat agent for unassigned actions."""
    os.environ["DATA_DIR"] = str(tmp_path / "data")
    init_db()

    captured = {}

    def fake_client(base_url, api_key, model, **kwargs):
        captured["base_url"] = base_url
        captured["model"] = model
        return object()

    monkeypatch.setattr(subagents, "OpenAIClient", fake_client)
    monkeypatch.setattr(
        subagents,
        "_run_subagent_in_thread",
        lambda ctx, client, registry, messages, max_turns: {"summary": "ok"},
    )

    from hestia import actions
    from hestia.registry.models import ActionDefault

    with Session(engine()) as s:
        strong = Provider(name="strong", base_url="http://strong", model="big")
        cheap = Provider(name="cheap", base_url="http://cheap", model="small")
        s.add(strong)
        s.add(cheap)
        s.commit()
        s.refresh(strong)
        s.refresh(cheap)
        a_chat = AgentConfig(name="default", provider_id=strong.id, tools="repo", max_turns=3)
        a_explore = AgentConfig(name="explore", provider_id=cheap.id, tools="repo", max_turns=3)
        s.add(a_chat)
        s.add(a_explore)
        s.commit()
        s.refresh(a_chat)
        s.refresh(a_explore)
        s.add(ActionDefault(action="chat", agent_id=a_chat.id))
        s.add(ActionDefault(action="explore", agent_id=a_explore.id))
        s.commit()

        tools = {t.name: t for t in subagents.make_tools(s)}
        ctx = ProjectContext(project_id=1, name="t", repo_url="", local_path=tmp_path)

        tools["run_subagent"].handler(ctx, {"action": "explore", "task": "x"})
        assert captured == {"base_url": "http://cheap", "model": "small"}

        captured.clear()
        tools["run_subagent"].handler(ctx, {"action": "github-scan", "task": "x"})
        assert captured == {"base_url": "http://strong", "model": "big"}

        assert actions.resolve_action(s, "explore").name == "explore"
        assert actions.resolve_action(s, "github-scan").name == "default"


def test_subagent_uses_agent_model_override(tmp_path, monkeypatch):
    os.environ["DATA_DIR"] = str(tmp_path / "data")
    init_db()

    captured = {}

    def fake_client(base_url, api_key, model, **kwargs):
        captured["model"] = model
        return object()

    monkeypatch.setattr(subagents, "OpenAIClient", fake_client)
    monkeypatch.setattr(
        subagents,
        "_run_subagent_in_thread",
        lambda ctx, client, registry, messages, max_turns: {"summary": "ok"},
    )

    with Session(engine()) as s:
        provider = Provider(
            name="multi", base_url="http://x", model="m1", models='["m1","m2"]'
        )
        s.add(provider)
        s.commit()
        s.refresh(provider)
        s.add(AgentConfig(name="explore-ovr", provider_id=provider.id, model="m2", tools="repo", max_turns=2))
        s.commit()

        tools = {t.name: t for t in subagents.make_tools(s)}
        ctx = ProjectContext(project_id=1, name="t", repo_url="", local_path=tmp_path)
        tools["run_subagent"].handler(ctx, {"agent": "explore-ovr", "task": "x"})

    assert captured["model"] == "m2"
