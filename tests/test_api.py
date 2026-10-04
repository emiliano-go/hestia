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


def test_open_returns_previous_opened_at(client):
    project = _mk_project(client)
    first = client.post(f"/api/projects/{project['id']}/open").json()
    assert first["previous_opened_at"] is None
    assert first["last_opened_at"]
    second = client.post(f"/api/projects/{project['id']}/open").json()
    assert second["previous_opened_at"] == first["last_opened_at"]


def test_task_crud(client):
    project = _mk_project(client)
    pid = project["id"]
    assert client.get(f"/api/projects/{pid}/tasks").json() == []

    t1 = client.post(f"/api/projects/{pid}/tasks", json={"title": "Write tests"}).json()
    assert t1["status"] == "backlog" and t1["priority"] == "medium"
    t2 = client.post(
        f"/api/projects/{pid}/tasks",
        json={"title": "Ship it", "status": "doing", "priority": "high"},
    ).json()
    assert t2["status"] == "doing"

    assert client.post(f"/api/projects/{pid}/tasks", json={"title": "x", "status": "nope"}).status_code == 400
    assert client.post(f"/api/projects/{pid}/tasks", json={"title": "  "}).status_code == 400

    moved = client.put(
        f"/api/tasks/{t1['id']}", json={"status": "done", "title": "Write more tests"}
    ).json()
    assert moved["status"] == "done" and moved["title"] == "Write more tests"

    assert client.delete(f"/api/tasks/{t2['id']}").status_code == 204
    assert [t["id"] for t in client.get(f"/api/projects/{pid}/tasks").json()] == [t1["id"]]
    assert client.get("/api/projects/999/tasks").status_code == 404


def test_task_agent_tools(client):
    from sqlmodel import Session as SqlSession

    from home.registry.db import engine
    from home.tools import tasks as task_tools
    from home.tools.registry import ProjectContext

    project = _mk_project(client)
    ctx = ProjectContext(
        project_id=project["id"],
        name=project["name"],
        repo_url=project["repo_url"],
        local_path=Path(project["local_path"]),
    )
    with SqlSession(engine()) as db:
        tools = {t.name: t for t in task_tools.make_tools(db)}
        created = tools["task_create"].handler(ctx, {"title": "From agent", "status": "todo"})
        assert created["status"] == "todo"
        assert any(t["id"] == created["id"] for t in tools["task_list"].handler(ctx, {}))
        moved = tools["task_update"].handler(ctx, {"id": created["id"], "status": "done"})
        assert moved["status"] == "done"
        tools["task_delete"].handler(ctx, {"id": created["id"]})
        assert tools["task_list"].handler(ctx, {}) == []


def test_status_board(client):
    project = _mk_project(client)
    pid = project["id"]
    client.post(f"/api/projects/{pid}/tasks", json={"title": "one", "status": "doing"})

    data = client.get(f"/api/projects/{pid}/status").json()
    assert data["git"]["branch"] in ("master", "main")
    assert data["git"]["last_commit"]["subject"] == "i"
    assert data["github"]["available"] is False
    assert data["tasks"]["total"] == 1
    assert data["tasks"]["by_status"]["doing"] == 1
    assert data["changes"]["first_visit"] is True


def test_status_since_and_activity(client):
    project = _mk_project(client)
    pid = project["id"]
    (config.workspace_dir(project["name"]) / "plan.md").write_text("hi\n")
    totem_store.create(
        Path(project["local_path"]), type="gotcha", title="A gotcha", statement="x", tags=["t"]
    )

    data = client.get(
        f"/api/projects/{pid}/status", params={"since": "1970-01-01T00:00:00+00:00"}
    ).json()
    assert data["changes"]["first_visit"] is False
    counts = data["changes"]["counts"]
    assert counts["files"] >= 1
    assert counts["memories"] >= 1
    assert counts["commits"] >= 1

    items = client.get(
        f"/api/projects/{pid}/activity", params={"github": "false"}
    ).json()["items"]
    kinds = {i["kind"] for i in items}
    assert {"file", "memory", "commit"} <= kinds


def test_github_list_unavailable(client):
    project = _mk_project(client)
    data = client.get(f"/api/projects/{project['id']}/github", params={"kind": "prs"}).json()
    assert data["available"] is False
    assert data["items"] == []
    assert client.get(
        f"/api/projects/{project['id']}/github", params={"kind": "bogus"}
    ).status_code == 400


def test_milestone_crud_and_progress(client):
    project = _mk_project(client)
    pid = project["id"]
    assert client.get(f"/api/projects/{pid}/milestones").json() == []

    milestone = client.post(
        f"/api/projects/{pid}/milestones",
        json={"title": "v1.0", "description": "First release", "target_date": "2026-12-01"},
    ).json()
    assert milestone["status"] == "open"
    assert milestone["memories"] == []
    assert milestone["progress"]["total"] == 0

    t1 = client.post(
        f"/api/projects/{pid}/tasks", json={"title": "a", "milestone_id": milestone["id"]}
    ).json()
    assert t1["milestone_id"] == milestone["id"]
    client.post(
        f"/api/projects/{pid}/tasks",
        json={"title": "b", "milestone_id": milestone["id"], "status": "done"},
    )

    listed = client.get(f"/api/projects/{pid}/milestones").json()
    assert listed[0]["progress"]["total"] == 2
    assert listed[0]["progress"]["done"] == 1
    assert listed[0]["progress"]["percent"] == 50

    updated = client.put(
        f"/api/milestones/{milestone['id']}",
        json={"status": "done", "memories": [{"id": "mem-1", "title": "Use sqlite"}]},
    ).json()
    assert updated["status"] == "done"
    assert updated["memories"] == [{"id": "mem-1", "title": "Use sqlite"}]

    assert client.post(f"/api/projects/{pid}/milestones", json={"title": "  "}).status_code == 400

    # deleting a milestone detaches its tasks instead of deleting them
    assert client.delete(f"/api/milestones/{milestone['id']}").status_code == 204
    assert all(t["milestone_id"] is None for t in client.get(f"/api/projects/{pid}/tasks").json())
    assert client.get(f"/api/projects/{pid}/milestones").json() == []


def test_task_agent_milestone_tools(client):
    from sqlmodel import Session as SqlSession

    from home.registry.db import engine
    from home.tools import tasks as task_tools
    from home.tools.registry import ProjectContext

    project = _mk_project(client)
    ctx = ProjectContext(
        project_id=project["id"],
        name=project["name"],
        repo_url=project["repo_url"],
        local_path=Path(project["local_path"]),
    )
    with SqlSession(engine()) as db:
        tools = {t.name: t for t in task_tools.make_tools(db)}
        milestone = tools["milestone_create"].handler(ctx, {"title": "Beta"})
        assert milestone["title"] == "Beta"
        created = tools["task_create"].handler(
            ctx, {"title": "ship", "milestone_id": milestone["id"]}
        )
        assert created["milestone_id"] == milestone["id"]
        listed = tools["milestone_list"].handler(ctx, {})
        assert listed[0]["progress"]["total"] == 1
        moved = tools["milestone_update"].handler(
            ctx, {"id": milestone["id"], "status": "done"}
        )
        assert moved["status"] == "done"


def test_triage_creates_task_and_plan(client, monkeypatch):
    from home import overview
    from home.agent import loop as agent_loop

    project = _mk_project(client)
    provider = _mk_provider(client)
    agent = client.post(
        "/api/agents", json={"name": "triager", "provider_id": provider["id"]}
    ).json()
    client.put("/api/actions/triage", json={"agent_id": agent["id"]})

    monkeypatch.setattr(
        overview,
        "github_item",
        lambda p, kind, number: {
            "kind": "issue",
            "number": number,
            "title": "Support plugins",
            "body": "We need a plugin system.",
            "state": "open",
            "user": "eve",
            "url": "https://github.com/a/b/issues/7",
            "labels": ["enhancement"],
        },
    )

    async def fake_run_turn(ctx, client_, registry, messages, max_turns=10):
        system = messages[0]["content"]
        assert "Support plugins" in system
        assert "plans/issue-7.md" in system
        assert {t.name for t in registry.all()} >= {"task_create", "workspace_write"}
        yield {"type": "message", "content": "Plan written and 2 tasks created.", "tool_calls": []}

    monkeypatch.setattr(agent_loop, "run_turn", fake_run_turn)

    resp = client.post(
        f"/api/projects/{project['id']}/triage", json={"kind": "issue", "number": 7}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["report"] == "Plan written and 2 tasks created."
    assert body["path"] == "plans/issue-7.md"
    assert body["task_id"]

    tasks = client.get(f"/api/projects/{project['id']}/tasks").json()
    assert any(t["title"].startswith("#7 Support plugins") for t in tasks)

    assert client.post(
        f"/api/projects/{project['id']}/triage", json={"kind": "issue"}
    ).status_code == 400
