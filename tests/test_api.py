"""API tests for workspace browsing, gallery, and the memory fixer endpoint."""

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from home import config, totem_store


@pytest.fixture
def client(tmp_path, monkeypatch):
    os.environ["DATA_DIR"] = str(tmp_path / "data")
    monkeypatch.setattr(config, "data_dir", lambda: tmp_path / "data")

    import home.registry.db as db

    monkeypatch.setattr(db, "_engine", None)

    from home.main import create_app

    return TestClient(create_app())


def _mk_project(client, name="demo", repo_url="https://github.com/a/b"):
    import subprocess, tempfile

    src = tempfile.mkdtemp()
    subprocess.run(["git", "init", "-q"], cwd=src, check=True)
    (Path(src) / "README.md").write_text("# demo\n")
    subprocess.run(["git", "add", "."], cwd=src, check=True)
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "i"], cwd=src, check=True)
    resp = client.post("/api/projects", json={"name": name, "repo_url": src})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_workspace_list_and_read(client):
    project = _mk_project(client)
    ws = config.workspace_dir(project["name"])
    (ws / "plans").mkdir(parents=True)
    (ws / "plans" / "auth.md").write_text("# Auth plan\n")

    resp = client.get(f"/api/projects/{project['id']}/workspace")
    assert resp.json()["files"] == [{"path": "plans/auth.md", "bytes": len("# Auth plan\n")}]

    resp = client.get(f"/api/projects/{project['id']}/workspace/file", params={"path": "plans/auth.md"})
    assert resp.status_code == 200
    assert resp.text == "# Auth plan\n"

    resp = client.get(f"/api/projects/{project['id']}/workspace/file", params={"path": "../README.md"})
    assert resp.status_code == 404


def test_gallery(client):
    project = _mk_project(client)
    (config.workspace_dir(project["name"]) / "spec.md").write_text("spec\n")
    entries = client.get("/api/gallery").json()
    assert entries == [
        {"project_id": project["id"], "project": "demo", "path": "spec.md", "bytes": 5}
    ]


def test_memory_fix(client, monkeypatch):
    from home.agent import loop as agent_loop

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


def test_activity_empty(client):
    data = client.get("/api/activity").json()
    assert data["counts"] == {"projects": 0, "sessions": 0, "files": 0}
    assert data["projects"] == []
    assert data["sessions"] == []
    assert data["files"] == []


def test_open_project_and_activity(client):
    project = _mk_project(client)
    (config.workspace_dir(project["name"]) / "plan.md").write_text("hi\n")

    resp = client.post(f"/api/projects/{project['id']}/open")
    assert resp.status_code == 200
    assert resp.json()["last_opened_at"]

    data = client.get("/api/activity").json()
    assert data["counts"] == {"projects": 1, "sessions": 0, "files": 1}
    assert data["projects"][0]["id"] == project["id"]
    assert data["projects"][0]["last_opened_at"]
    assert data["files"][0]["path"] == "plan.md"
    assert data["files"][0]["project"] == "demo"


def _mk_provider(client, name="p"):
    return client.post("/api/providers", json={
        "name": name, "base_url": "http://x", "api_key_env": "K", "model": "m",
    }).json()


def test_action_defaults_roundtrip(client):
    provider = _mk_provider(client)
    agent = client.post("/api/agents", json={
        "name": "default", "provider_id": provider["id"], "tools": ["repo"], "max_turns": 3,
    }).json()

    actions = client.get("/api/actions").json()
    assert next(a for a in actions if a["key"] == "chat")["agent_id"] is None
    assert all("description" in a for a in actions)

    assert client.put("/api/actions/chat", json={"agent_id": agent["id"]}).status_code == 200
    actions = client.get("/api/actions").json()
    assert next(a for a in actions if a["key"] == "chat")["agent_id"] == agent["id"]

    assert client.put("/api/actions/nope", json={"agent_id": None}).status_code == 404

    updated = client.put(
        f"/api/agents/{agent['id']}", json={"max_turns": 5, "tools": ["repo", "memory"]}
    ).json()
    assert updated["max_turns"] == 5
    assert updated["tools"] == "repo,memory"


def test_action_resolution_falls_back_to_chat(client):
    from sqlmodel import Session as SqlSession

    from home import actions as actions_mod
    from home.registry.db import engine

    provider = _mk_provider(client)
    solo = client.post("/api/agents", json={
        "name": "solo", "provider_id": provider["id"],
    }).json()
    client.put("/api/actions/chat", json={"agent_id": solo["id"]})

    with SqlSession(engine()) as db:
        assert actions_mod.resolve_action(db, "explore").id == solo["id"]

    client.put("/api/actions/chat", json={"agent_id": None})
    client.post("/api/agents", json={"name": "explore", "provider_id": provider["id"]})
    with SqlSession(engine()) as db:
        assert actions_mod.resolve_action(db, "explore").name == "explore"
