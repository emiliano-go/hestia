"""Subagent delegation: main agent spawns a profile with its own fake model."""

import os

from sqlmodel import Session

from home.registry.db import engine, init_db
from home.registry.models import AgentConfig, Provider
from home.tools.registry import ProjectContext
from home.tools import subagents
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
