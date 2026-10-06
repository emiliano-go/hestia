"""Totem memory fixer and user memory tools."""

from pathlib import Path

from hestia import totem_store

from tests.api.conftest import _mk_project


def test_memory_fix(client, monkeypatch):
    from hestia.agent import loop as agent_loop

    project = _mk_project(client)
    totem_store.create(
        Path(project["local_path"]),
        type="gotcha",
        title="Old fact",
        statement="The backend used to be Flask.",
        tags=["stack"],
    )
    provider = client.post("/api/providers", json={
        "name": "fake", "base_url": "http://x", "api_key_env": "NOPE", "model": "m",
    }).json()

    async def fake_run_turn(ctx, client_, registry, messages, max_turns=10):
        # memory-only registry, catalog in system prompt, instruction in user msg
        assert set(registry._tools) == {"memory_search", "memory_get", "memory_list",
                                        "memory_create", "memory_update", "memory_delete"}
        assert "Old fact" in messages[0]["content"]
        assert "fix it" in messages[-1]["content"]
        yield {"type": "message", "content": "Fixed 1 memory.", "tool_calls": []}

    monkeypatch.setattr(agent_loop, "run_turn", fake_run_turn)
    resp = client.post(
        f"/api/projects/{project['id']}/memory/fix",
        json={"instruction": "fix it", "provider_id": provider["id"]},
    )
    assert resp.status_code == 200
    assert resp.json() == {"report": "Fixed 1 memory."}


def test_user_memory_tools(client):
    from sqlmodel import Session as SqlSession

    from hestia.registry.db import engine
    from hestia.registry.models import Project
    from hestia.tools import preferences as pref_tools
    from hestia.tools.registry import ProjectContext

    project = _mk_project(client)
    with SqlSession(engine()) as db:
        ctx = ProjectContext.from_project(db.get(Project, project["id"]))
        tools = {t.name: t for t in pref_tools.make_tools(db)}
        tools["set_owner_name"].handler(ctx, {"name": "Sam"})
        tools["remember_preference"].handler(ctx, {"text": "Reply in short bullet points."})
        listing = tools["list_preferences"].handler(ctx, {})
        assert listing["user_name"] == "Sam"
        assert listing["preferences"] == ["Reply in short bullet points."]
        tools["forget_preference"].handler(ctx, {"index": 0})
        assert tools["list_preferences"].handler(ctx, {})["preferences"] == []

    assert client.get("/api/settings").json()["user_name"] == "Sam"
