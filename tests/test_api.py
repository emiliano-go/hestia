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


def _mk_project(client, name="demo", repo_url=None):
    import subprocess, tempfile

    src = tempfile.mkdtemp()
    subprocess.run(["git", "init", "-q"], cwd=src, check=True)
    (Path(src) / "README.md").write_text("# demo\n")
    subprocess.run(["git", "add", "."], cwd=src, check=True)
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "i"], cwd=src, check=True)
    resp = client.post("/api/projects", json={"name": name, "repo_url": repo_url or src})
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


def test_docs_generation(client, monkeypatch):
    from home.agent import loop as agent_loop

    project = _mk_project(client)
    provider = _mk_provider(client)
    agent = client.post(
        "/api/agents", json={"name": "writer", "provider_id": provider["id"]}
    ).json()
    client.put("/api/actions/docs", json={"agent_id": agent["id"]})

    seen = {}

    async def fake_run_turn(ctx, client_, registry, messages, max_turns=10):
        seen["system"] = messages[0]["content"]
        seen["tools"] = {t.name for t in registry.all()}
        yield {"type": "message", "content": "Wrote ARCHITECTURE.md", "tool_calls": []}

    monkeypatch.setattr(agent_loop, "run_turn", fake_run_turn)

    resp = client.post(f"/api/projects/{project['id']}/docs", json={"kind": "architecture"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "report": "Wrote ARCHITECTURE.md",
        "path": "ARCHITECTURE.md",
        "kind": "architecture",
    }
    assert "ARCHITECTURE.md" in seen["system"]
    assert {"workspace_write", "memory_search"} <= seen["tools"]

    resp = client.post(
        f"/api/projects/{project['id']}/docs",
        json={"kind": "adr", "topic": "Use SQLite"},
    )
    assert resp.json()["path"] == "adr/use-sqlite.md"

    assert client.post(
        f"/api/projects/{project['id']}/docs", json={"kind": "adr"}
    ).status_code == 400
    assert client.post(
        f"/api/projects/{project['id']}/docs", json={"kind": "nope"}
    ).status_code == 400
    assert client.post("/api/projects/999/docs", json={}).status_code == 404


def test_global_search(client):
    from sqlmodel import Session as SqlSession

    from home.registry.db import engine
    from home.registry.models import Session as ChatSession

    alpha = _mk_project(client, name="alpha")
    beta = _mk_project(client, name="beta")
    (config.workspace_dir("alpha") / "notes.md").write_text(
        "The quartz migration plan\n", encoding="utf-8"
    )
    totem_store.create(
        Path(alpha["local_path"]),
        type="decision",
        title="Quartz choice",
        statement="We chose quartz for the scheduler.",
        tags=["t"],
    )
    with SqlSession(engine()) as db:
        db.add(ChatSession(project_id=beta["id"], title="Quartz rollout chat"))
        db.commit()

    data = client.get("/api/search", params={"q": "quartz"}).json()
    assert any(m["title"] == "Quartz choice" and m["project"] == "alpha" for m in data["memories"])
    assert any(f["path"] == "notes.md" and f["project"] == "alpha" for f in data["files"])
    assert any(s["title"] == "Quartz rollout chat" and s["project"] == "beta" for s in data["sessions"])

    assert client.get("/api/search", params={"q": "zzznothing"}).json() == {
        "query": "zzznothing",
        "memories": [],
        "files": [],
        "sessions": [],
    }


def test_inbox_poll_and_read(client, monkeypatch):
    from home import overview

    project = _mk_project(client)
    prs = [
        {
            "number": 1,
            "title": "Add caching",
            "user": "eve",
            "url": "https://github.com/a/b/pull/1",
        }
    ]
    runs = [
        {
            "id": 11,
            "name": "CI",
            "conclusion": "failure",
            "url": "https://github.com/a/b/runs/11",
        },
        {"id": 12, "name": "CI", "conclusion": "success", "url": "x"},
    ]

    def fake_github_list(project_, kind, state="open", limit=30):
        items = prs if kind == "prs" else runs if kind == "runs" else []
        return {"available": True, "repo": "a/b", "items": items}

    monkeypatch.setattr(overview, "github_list", fake_github_list)
    monkeypatch.setattr(overview, "repo_slug", lambda url: "a/b")

    # first poll is a baseline: items arrive already read
    assert client.post("/api/inbox/poll").json()["added"] == 2
    data = client.get("/api/inbox").json()
    assert data["unread"] == 0
    assert {i["kind"] for i in data["items"]} == {"pr", "run"}

    # a new PR shows up unread
    prs.append(
        {"number": 2, "title": "Fix bug", "user": "bob", "url": "https://github.com/a/b/pull/2"}
    )
    assert client.post("/api/inbox/poll").json()["added"] == 1
    data = client.get("/api/inbox", params={"unread": "true"}).json()
    assert data["unread"] == 1
    assert data["items"][0]["title"] == "#2 Fix bug"

    assert client.post("/api/inbox/read-all").json() == {"ok": True}
    assert client.get("/api/inbox").json()["unread"] == 0


def test_auth_disabled_by_default(client):
    data = client.get("/api/auth/status").json()
    assert data["enabled"] is False
    assert data["authenticated"] is True
    assert client.get("/api/projects").status_code == 200


def test_auth_gate_and_session(client, monkeypatch):
    from home import auth

    monkeypatch.setenv("HOME_SETUP_TOKEN", "s3cret")

    assert client.get("/api/projects").status_code == 401
    data = client.get("/api/auth/status").json()
    assert data == {
        "enabled": True,
        "authenticated": False,
        "has_passkeys": False,
        "rp_id": "testserver",
    }

    assert client.post(
        "/api/auth/register/begin", json={"setup_token": "nope"}
    ).status_code == 403
    begin = client.post(
        "/api/auth/register/begin", json={"setup_token": "s3cret"}
    ).json()
    assert begin["options"]["publicKey"]["challenge"]
    assert begin["ceremony"]

    assert client.post("/api/auth/login/begin", json={}).status_code == 400

    client.cookies.set(auth.SESSION_COOKIE, auth.make_session())
    assert client.get("/api/projects").status_code == 200
    assert client.get("/api/auth/status").json()["authenticated"] is True

    client.cookies.set(auth.SESSION_COOKIE, "9999999999.deadbeef")
    assert client.get("/api/projects").status_code == 401


def test_git_writes_gated_and_sandboxed(client):
    import subprocess

    from home.tools import build_registry, gitwrites
    from home.tools.registry import ProjectContext

    project = _mk_project(client)
    assert project["allow_git_writes"] is False
    toggled = client.put(
        f"/api/projects/{project['id']}/git-writes", json={"enabled": True}
    ).json()
    assert toggled["allow_git_writes"] is True

    ctx = ProjectContext(
        project_id=project["id"],
        name=project["name"],
        repo_url=project["repo_url"],
        local_path=Path(project["local_path"]),
    )
    tools = {t.name: t for t in build_registry(writes=True).all()}

    written = tools["write_file"].handler(
        ctx, {"path": "src/new.py", "content": "print('hi')\n"}
    )
    assert written["path"] == "src/new.py"
    assert (Path(project["local_path"]) / "src" / "new.py").exists()

    with pytest.raises(PermissionError):
        tools["write_file"].handler(ctx, {"path": "../escape.txt", "content": "x"})
    with pytest.raises(PermissionError):
        tools["write_file"].handler(ctx, {"path": ".git/config", "content": "x"})

    assert tools["git_create_branch"].handler(ctx, {"name": "feature/test"})["branch"] == "feature/test"
    with pytest.raises(ValueError):
        tools["git_create_branch"].handler(ctx, {"name": "bad..name"})

    commit = tools["git_commit"].handler(
        ctx, {"message": "add new file", "paths": ["src/new.py"]}
    )
    assert commit["sha"] and commit["files"] == ["src/new.py"]
    log = subprocess.run(
        ["git", "log", "-1", "--format=%s"],
        cwd=project["local_path"],
        capture_output=True,
        text=True,
    ).stdout.strip()
    assert log == "add new file"
    with pytest.raises(ValueError):
        tools["git_commit"].handler(ctx, {"message": "nothing", "paths": ["README.md"]})

    # mutating tools exist only in the opted-in registry
    assert "write_file" not in {t.name for t in build_registry().all()}
    assert "write_file" in {t.name for t in build_registry(writes=True).all()}


def test_git_push_to_remote(client):
    import subprocess
    import tempfile

    from home.tools import build_registry
    from home.tools.registry import ProjectContext

    bare = tempfile.mkdtemp()
    subprocess.run(["git", "init", "--bare", "-q"], cwd=bare, check=True)
    project = _mk_project(client, name="pushy", repo_url=bare)
    client.put(f"/api/projects/{project['id']}/git-writes", json={"enabled": True})

    ctx = ProjectContext(
        project_id=project["id"],
        name=project["name"],
        repo_url=project["repo_url"],
        local_path=Path(project["local_path"]),
    )
    tools = {t.name: t for t in build_registry(writes=True).all()}
    tools["write_file"].handler(ctx, {"path": "hello.txt", "content": "hi\n"})
    tools["git_commit"].handler(ctx, {"message": "hello"})
    pushed = tools["git_push"].handler(ctx, {})

    branches = subprocess.run(
        ["git", "branch"], cwd=bare, capture_output=True, text=True
    ).stdout
    assert pushed["branch"] in branches


def test_open_pr_requires_token_and_payload(client, monkeypatch):
    from home import config
    from home.tools import build_registry, gitwrites
    from home.tools.registry import ProjectContext

    project = _mk_project(client, name="prtest")
    ctx = ProjectContext(
        project_id=project["id"],
        name=project["name"],
        repo_url="https://github.com/a/b",
        local_path=Path(project["local_path"]),
    )
    tools = {t.name: t for t in build_registry(writes=True).all()}

    monkeypatch.setattr(config, "github_token", lambda: None)
    with pytest.raises(PermissionError):
        tools["gh_open_pr"].handler(ctx, {"title": "x"})

    monkeypatch.setattr(config, "github_token", lambda: "tok")
    monkeypatch.setattr(gitwrites, "_default_branch", lambda slug: "main")
    captured = {}

    def fake_create_pr(slug, payload):
        captured["slug"] = slug
        captured["payload"] = payload
        return {"number": 7, "html_url": "https://github.com/a/b/pull/7"}

    monkeypatch.setattr(gitwrites, "_create_pr", fake_create_pr)
    out = tools["gh_open_pr"].handler(ctx, {"title": "Add feature", "body": "b"})
    assert out["number"] == 7 and out["base"] == "main"
    assert captured["slug"] == "a/b"
    assert captured["payload"]["title"] == "Add feature"


def test_task_dependencies(client):
    project = _mk_project(client)
    pid = project["id"]
    a = client.post(f"/api/projects/{pid}/tasks", json={"title": "a"}).json()
    b = client.post(
        f"/api/projects/{pid}/tasks", json={"title": "b", "depends_on": [a["id"]]}
    ).json()
    assert b["depends_on"] == [a["id"]]
    assert b["blocked_by"] == [a["id"]]

    ready = client.get(f"/api/projects/{pid}/tasks", params={"ready": "true"}).json()
    assert {t["id"] for t in ready} == {a["id"]}

    client.put(f"/api/tasks/{a['id']}", json={"status": "done"})
    tasks = {t["id"]: t for t in client.get(f"/api/projects/{pid}/tasks").json()}
    assert tasks[b["id"]]["blocked_by"] == []
    ready = client.get(f"/api/projects/{pid}/tasks", params={"ready": "true"}).json()
    assert {t["id"] for t in ready} == {b["id"]}

    # self-dependency, unknown id, cross-project id, and cycles are rejected
    assert client.post(
        f"/api/projects/{pid}/tasks", json={"title": "x", "depends_on": [999]}
    ).status_code == 400
    assert client.put(f"/api/tasks/{a['id']}", json={"depends_on": [a["id"]]}).status_code == 400
    assert client.put(f"/api/tasks/{a['id']}", json={"depends_on": [b["id"]]}).status_code == 400
    other = _mk_project(client, name="other")
    d = client.post(f"/api/projects/{other['id']}/tasks", json={"title": "d"}).json()
    assert client.put(f"/api/tasks/{a['id']}", json={"depends_on": [d["id"]]}).status_code == 400

    # deleting a task removes it from other tasks' dependencies
    c = client.post(
        f"/api/projects/{pid}/tasks", json={"title": "c", "depends_on": [b["id"]]}
    ).json()
    client.delete(f"/api/tasks/{b['id']}")
    tasks = {t["id"]: t for t in client.get(f"/api/projects/{pid}/tasks").json()}
    assert tasks[c["id"]]["depends_on"] == []
    assert tasks[c["id"]]["blocked_by"] == []


def test_goal_crud_and_discuss(client):
    project = _mk_project(client)
    pid = project["id"]
    assert client.get(f"/api/projects/{pid}/goals").json() == []

    goal = client.post(
        f"/api/projects/{pid}/goals",
        json={"title": "Ship v1", "description": "first release", "success_criteria": "tests pass"},
    ).json()
    assert goal["status"] == "drafting"
    assert goal["progress"] is None

    first = client.post(f"/api/goals/{goal['id']}/discuss").json()
    assert first["session_id"] and first["seed"] and "Ship v1" in first["seed"]
    assert first["spec_path"] == "goals/ship-v1/spec.md"
    again = client.post(f"/api/goals/{goal['id']}/discuss").json()
    assert again["session_id"] == first["session_id"] and again["seed"] is None

    updated = client.put(f"/api/goals/{goal['id']}", json={"status": "active"}).json()
    assert updated["status"] == "active"
    assert client.post(f"/api/projects/{pid}/goals", json={"title": " "}).status_code == 400
    assert client.put(f"/api/goals/{goal['id']}", json={"status": "nope"}).status_code == 400
    assert client.get(f"/api/goals/999").status_code == 404

    assert client.delete(f"/api/goals/{goal['id']}").status_code == 204
    assert client.get(f"/api/projects/{pid}/goals").json() == []


def test_goal_plan_and_converge(client, monkeypatch):
    from home.agent import loop as agent_loop

    project = _mk_project(client)
    provider = _mk_provider(client)
    goal = client.post(
        f"/api/projects/{project['id']}/goals",
        json={"title": "Add search", "success_criteria": "users can search"},
    ).json()

    seen = {}

    async def fake_run_turn(ctx, client_, registry, messages, max_turns=10):
        seen["system"] = messages[0]["content"]
        seen["tools"] = {t.name for t in registry.all()}
        yield {"type": "message", "content": "Planned: 3 tasks.", "tool_calls": []}

    monkeypatch.setattr(agent_loop, "run_turn", fake_run_turn)

    resp = client.post(
        f"/api/goals/{goal['id']}/plan", json={"provider_id": provider["id"]}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["spec_path"] == "goals/add-search/spec.md"
    assert body["plan_path"] == "goals/add-search/plan.md"
    assert body["milestone_id"]
    assert "Add search" in seen["system"]
    assert "add-search/spec.md" in seen["system"]
    assert "acceptance" in seen["system"]
    assert {"task_create", "milestone_create"} <= seen["tools"]

    refreshed = client.get(f"/api/goals/{goal['id']}").json()
    assert refreshed["status"] == "active"
    assert refreshed["milestone_id"] == body["milestone_id"]

    resp = client.post(
        f"/api/goals/{goal['id']}/converge", json={"provider_id": provider["id"]}
    )
    assert resp.status_code == 200
    assert resp.json()["report"] == "Planned: 3 tasks."

    assert client.post("/api/goals/999/plan", json={}).status_code == 404


def test_chat_goal_action(client, monkeypatch):
    from home.routers import chat as chat_router

    project = _mk_project(client)
    provider = _mk_provider(client)
    seen = {}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def stream_chat(self, messages, tools=None):
            seen["system"] = messages[0]["content"]
            yield {"choices": [{"delta": {"content": "ok"}}]}

    monkeypatch.setattr(chat_router, "OpenAIClient", FakeClient)
    resp = client.post(
        f"/api/projects/{project['id']}/chat",
        json={"message": "hi", "provider_id": provider["id"], "action": "goal"},
    )
    assert resp.status_code == 200
    assert "Goal mode" in seen["system"]


def test_task_review_gate(client):
    project = _mk_project(client)
    pid = project["id"]
    plain = client.post(f"/api/projects/{pid}/tasks", json={"title": "plain"}).json()
    assert client.put(f"/api/tasks/{plain['id']}", json={"status": "done"}).status_code == 200

    gated = client.post(
        f"/api/projects/{pid}/tasks",
        json={"title": "gated", "acceptance": "tests pass"},
    ).json()
    assert gated["acceptance"] == "tests pass"
    resp = client.put(f"/api/tasks/{gated['id']}", json={"status": "done"})
    assert resp.status_code == 400
    assert "reviewed" in resp.json()["detail"]

    moved = client.put(
        f"/api/tasks/{gated['id']}", json={"status": "done", "reviewed": True}
    ).json()
    assert moved["status"] == "done"
    # already done: editing without reviewed is fine
    assert client.put(f"/api/tasks/{gated['id']}", json={"title": "gated v2"}).status_code == 200


def test_task_comments(client):
    project = _mk_project(client)
    pid = project["id"]
    task = client.post(f"/api/projects/{pid}/tasks", json={"title": "t"}).json()

    assert client.get(f"/api/tasks/{task['id']}/comments").json() == []
    created = client.post(
        f"/api/tasks/{task['id']}/comments", json={"body": "started"}
    ).json()
    assert created["author"] == "you" and created["body"] == "started"
    assert client.post(f"/api/tasks/{task['id']}/comments", json={"body": " "}).status_code == 400

    items = client.get(f"/api/tasks/{task['id']}/comments").json()
    assert [c["body"] for c in items] == ["started"]
    assert client.get("/api/tasks/999/comments").status_code == 404


def test_task_agent_get_and_comment(client):
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
        created = tools["task_create"].handler(
            ctx, {"title": "with acceptance", "acceptance": "green CI"}
        )
        assert created["acceptance"] == "green CI"
        tools["task_comment"].handler(ctx, {"id": created["id"], "body": "note"})
        fetched = tools["task_get"].handler(ctx, {"id": created["id"]})
        assert fetched["comments"][0]["author"] == "agent"
        assert fetched["comments"][0]["body"] == "note"
        with pytest.raises(ValueError):
            tools["task_update"].handler(ctx, {"id": created["id"], "status": "done"})
        moved = tools["task_update"].handler(
            ctx, {"id": created["id"], "status": "done", "reviewed": True}
        )
        assert moved["status"] == "done"


def test_issue_sync(client, monkeypatch):
    from home import issuesync

    project = _mk_project(client)
    pid = project["id"]
    client.post(
        f"/api/projects/{pid}/tasks", json={"title": "ship", "acceptance": "green CI"}
    )

    # gated by git writes
    assert client.post(f"/api/projects/{pid}/issues/sync", json={}).status_code == 403
    client.put(f"/api/projects/{pid}/git-writes", json={"enabled": True})
    # local repo has no GitHub slug
    assert client.post(f"/api/projects/{pid}/issues/sync", json={}).status_code == 400

    monkeypatch.setattr(issuesync.overview, "repo_slug", lambda url: "a/b")
    captured = []

    def fake_create(slug, payload):
        captured.append((slug, payload))
        return {"number": 42, "html_url": "https://github.com/a/b/issues/42"}

    monkeypatch.setattr(issuesync, "_create_issue", fake_create)

    resp = client.post(f"/api/projects/{pid}/issues/sync", json={}).json()
    assert resp["created"][0]["issue"] == 42
    assert captured[0][0] == "a/b"
    assert "green CI" in captured[0][1]["body"]

    # idempotent: already-synced tasks are skipped
    resp = client.post(f"/api/projects/{pid}/issues/sync", json={}).json()
    assert resp["created"] == [] and resp["skipped"] == 1
    tasks = client.get(f"/api/projects/{pid}/tasks").json()
    assert tasks[0]["github_issue"] == 42


def test_github_review(client, monkeypatch):
    from home import overview
    from home.agent import loop as agent_loop

    project = _mk_project(client)
    provider = _mk_provider(client)
    monkeypatch.setattr(
        overview,
        "github_item",
        lambda p, kind, number: {
            "kind": "pr",
            "number": number,
            "title": "Add caching",
            "body": "Cache the thing.",
            "state": "open",
            "user": "eve",
            "url": "https://github.com/a/b/pull/5",
            "branch": "cache",
        },
    )
    seen = {}

    async def fake_run_turn(ctx, client_, registry, messages, max_turns=10):
        seen["system"] = messages[0]["content"]
        seen["tools"] = {t.name for t in registry.all()}
        yield {"type": "message", "content": "LGTM with nits.", "tool_calls": []}

    monkeypatch.setattr(agent_loop, "run_turn", fake_run_turn)
    resp = client.post(
        f"/api/projects/{project['id']}/github/review",
        json={"kind": "pr", "number": 5, "provider_id": provider["id"]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"report": "LGTM with nits.", "path": "reviews/pr-5.md"}
    assert "reviews/pr-5.md" in seen["system"]
    assert "task_create" in seen["tools"]

    assert client.post(
        f"/api/projects/{project['id']}/github/review", json={"kind": "pr"}
    ).status_code == 400


def test_token_budget(client):
    import asyncio

    from sqlmodel import Session as SqlSession

    from home import scheduler
    from home.registry.db import engine
    from home.registry.models import Usage

    project = _mk_project(client)
    pid = project["id"]
    with SqlSession(engine()) as db:
        db.add(Usage(project_id=pid, action="chat", prompt_tokens=600, completion_tokens=400))
        db.commit()

    data = client.get(f"/api/projects/{pid}/usage").json()
    assert data["month"]["tokens"] == 1000
    assert data["budget"] == {
        "budget": None,
        "enforced": False,
        "used": 1000,
        "percent": None,
        "over": False,
    }

    updated = client.put(
        f"/api/projects/{pid}", json={"token_budget": 800, "budget_enforced": True}
    ).json()
    assert updated["token_budget"] == 800 and updated["budget_enforced"] is True
    assert client.put(f"/api/projects/{pid}", json={"token_budget": "abc"}).status_code == 400

    data = client.get(f"/api/projects/{pid}/usage").json()
    assert data["budget"]["over"] is True and data["budget"]["percent"] == 125

    sched = client.post(
        f"/api/projects/{pid}/schedules",
        json={"action": "github-scan", "instruction": "digest"},
    ).json()
    result = asyncio.run(scheduler.run_schedule(sched["id"]))
    assert result["last_status"] == "skipped: budget"


def test_notify_status_and_test(client, monkeypatch):
    from home import notify

    class FakeResp:
        status_code = 200
        text = "ok"

    calls = []
    monkeypatch.setattr(
        notify.httpx, "post", lambda url, **kw: calls.append((url, kw)) or FakeResp()
    )

    assert client.get("/api/notify/status").json() == {
        "configured": [],
        "channels": {"ntfy": False, "telegram": False},
    }
    assert client.post("/api/notify/test").status_code == 400

    monkeypatch.setenv("NTFY_URL", "https://ntfy.example")
    monkeypatch.setenv("NTFY_TOPIC", "home")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "42")

    status = client.get("/api/notify/status").json()
    assert set(status["configured"]) == {"ntfy", "telegram"}

    result = client.post("/api/notify/test").json()
    assert result["ntfy"]["ok"] and result["telegram"]["ok"]
    urls = [c[0] for c in calls]
    assert "https://ntfy.example/home" in urls
    assert any("api.telegram.org/bottok/sendMessage" in u for u in urls)
    assert calls[0][1]["headers"]["Title"] == "Home test notification"


def test_notify_tool(client, monkeypatch):
    from home import notify
    from home.tools import build_registry
    from home.tools.registry import ProjectContext

    class FakeResp:
        status_code = 200
        text = "ok"

    calls = []
    monkeypatch.setattr(
        notify.httpx, "post", lambda url, **kw: calls.append(url) or FakeResp()
    )
    monkeypatch.setenv("NTFY_TOPIC", "home")

    ctx = ProjectContext(project_id=1, name="t", repo_url="", local_path=Path("."))
    tool = build_registry().get("notify")
    out = tool.handler(ctx, {"title": "Deploy done", "message": "shipped"})
    assert out["ntfy"]["ok"]
    assert calls == ["https://ntfy.sh/home"]


def test_inbox_notifies_new_items(client, monkeypatch):
    from home import notify, overview

    _mk_project(client)
    prs = [{"number": 1, "title": "one", "user": "eve", "url": "u1"}]

    def fake_github_list(project_, kind, state="open", limit=30):
        return {"available": True, "repo": "a/b", "items": prs if kind == "prs" else []}

    monkeypatch.setattr(overview, "github_list", fake_github_list)
    monkeypatch.setattr(overview, "repo_slug", lambda url: "a/b")
    monkeypatch.setenv("NTFY_TOPIC", "home")

    class FakeResp:
        status_code = 200
        text = "ok"

    calls = []
    monkeypatch.setattr(notify.httpx, "post", lambda url, **kw: calls.append(url) or FakeResp())

    assert client.post("/api/inbox/poll").json()["added"] == 1
    assert calls == []  # the first poll is a silent baseline

    prs.append({"number": 2, "title": "two", "user": "bob", "url": "u2"})
    assert client.post("/api/inbox/poll").json()["added"] == 1
    assert calls == ["https://ntfy.sh/home"]


def test_ask_user_tool(client, monkeypatch):
    from sqlmodel import Session as SqlSession

    from home import notify
    from home import questions as questions_mod
    from home.agent.loop import AgentPause
    from home.registry.db import engine
    from home.registry.models import Session as ChatSession
    from home.tools import questions as question_tools
    from home.tools.registry import ProjectContext

    project = _mk_project(client)
    monkeypatch.setenv("NTFY_TOPIC", "home")

    class FakeResp:
        status_code = 200
        text = "ok"

    calls = []
    monkeypatch.setattr(notify.httpx, "post", lambda url, **kw: calls.append(url) or FakeResp())

    with SqlSession(engine()) as db:
        chat = ChatSession(project_id=project["id"], title="q")
        db.add(chat)
        db.commit()
        db.refresh(chat)
        ctx = ProjectContext(
            project_id=project["id"],
            name=project["name"],
            repo_url=project["repo_url"],
            local_path=Path(project["local_path"]),
            session_id=chat.id,
        )
        tool = question_tools.make_tools(db)[0]
        with pytest.raises(AgentPause) as exc:
            tool.handler(ctx, {"question": "Which DB?", "options": ["sqlite", "postgres"]})
        assert exc.value.payload["question"] == "Which DB?"
        assert exc.value.payload["options"] == ["sqlite", "postgres"]
        rows = questions_mod.list_for_session(db, chat.id)
        assert len(rows) == 1 and rows[0].status == "open"

        bare = ProjectContext(project_id=1, name="x", repo_url="", local_path=Path("."))
        with pytest.raises(ValueError):
            tool.handler(bare, {"question": "x"})

    assert calls == ["https://ntfy.sh/home"]


def test_chat_question_flow(client, monkeypatch):
    from home.agent import loop as agent_loop
    from home.agent.loop import AgentPause

    project = _mk_project(client)
    provider = _mk_provider(client)
    calls = {"n": 0}

    async def fake_run_turn(ctx, client_, registry, messages, max_turns=10):
        calls["n"] += 1
        if calls["n"] == 1:
            try:
                registry.get("ask_user").handler(
                    ctx, {"question": "Which database?", "options": ["sqlite", "postgres"]}
                )
            except AgentPause as pause:
                yield {"type": "question", **pause.payload}
                return
        yield {"type": "message", "content": "Understood.", "tool_calls": []}

    monkeypatch.setattr(agent_loop, "run_turn", fake_run_turn)

    resp = client.post(
        f"/api/projects/{project['id']}/chat",
        json={"message": "build it", "provider_id": provider["id"]},
    )
    assert resp.status_code == 200
    assert '"event": "question"' in resp.text
    assert "Which database?" in resp.text

    sid = client.get(f"/api/projects/{project['id']}/sessions").json()[0]["id"]
    qs = client.get(f"/api/sessions/{sid}/questions").json()
    assert len(qs) == 1
    assert qs[0]["status"] == "open"
    assert qs[0]["options"] == ["sqlite", "postgres"]

    # the question is persisted in the transcript, so it survives a reload
    messages = client.get(f"/api/sessions/{sid}/messages").json()
    assert any(
        m["role"] == "assistant" and "Which database?" in m["content"] for m in messages
    )

    # answering with the next message marks it answered
    resp = client.post(
        f"/api/projects/{project['id']}/chat",
        json={"message": "postgres", "session_id": sid, "provider_id": provider["id"]},
    )
    assert resp.status_code == 200
    qs = client.get(f"/api/sessions/{sid}/questions").json()
    assert qs[0]["status"] == "answered" and qs[0]["answer"] == "postgres"

    # dismiss endpoint
    assert client.post(f"/api/questions/{qs[0]['id']}/dismiss").json()["status"] == "dismissed"
    assert client.post("/api/questions/999/dismiss").status_code == 404
    assert client.get("/api/sessions/999/questions").status_code == 404


def test_settings_roundtrip(client, monkeypatch):
    from home import settings

    data = client.get("/api/settings").json()
    assert data["timezone"] == "UTC" and data["briefing_enabled"] == "0"

    updated = client.put(
        "/api/settings",
        json={
            "user_name": "Emi",
            "timezone": "Europe/Rome",
            "briefing_enabled": "1",
            "briefing_time": "07:30",
        },
    ).json()
    assert updated["user_name"] == "Emi"
    assert updated["timezone"] == "Europe/Rome"

    assert client.put("/api/settings", json={"timezone": "Not/AZone"}).status_code == 400
    assert client.put("/api/settings", json={"briefing_time": "25:00"}).status_code == 400
    assert client.put("/api/settings", json={"nope": "x"}).status_code == 400

    monkeypatch.setenv("HOME_ORIGIN", "https://home.example")
    assert settings.notification_url("/g/reminders") == "https://home.example/#/g/reminders"
    monkeypatch.delenv("HOME_ORIGIN")
    assert settings.notification_url("/g/reminders") is None


def test_prompt_includes_context(client, monkeypatch):
    from home.routers import chat as chat_router

    project = _mk_project(client)
    provider = _mk_provider(client)
    client.put(
        "/api/settings",
        json={"user_name": "Emi", "timezone": "Europe/Rome", "instructions": "Be terse."},
    )
    seen = {}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def stream_chat(self, messages, tools=None):
            seen["system"] = messages[0]["content"]
            yield {"choices": [{"delta": {"content": "ok"}}]}

    monkeypatch.setattr(chat_router, "OpenAIClient", FakeClient)
    resp = client.post(
        f"/api/projects/{project['id']}/chat",
        json={"message": "hi", "provider_id": provider["id"]},
    )
    assert resp.status_code == 200
    assert "Current time:" in seen["system"]
    assert "Emi" in seen["system"]
    assert "Be terse." in seen["system"]


def test_reminder_crud_and_fire(client, monkeypatch):
    from datetime import datetime, timedelta, timezone

    from sqlmodel import Session as SqlSession

    from home import notify, reminders
    from home.registry.db import engine

    class FakeResp:
        status_code = 200
        text = "ok"

    calls = []
    monkeypatch.setattr(notify.httpx, "post", lambda url, **kw: calls.append(url) or FakeResp())
    monkeypatch.setenv("NTFY_TOPIC", "home")

    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

    created = client.post(
        "/api/reminders",
        json={"text": "water plants", "due_at": past, "recurrence": "daily"},
    ).json()
    assert created["status"] == "pending" and created["recurrence"] == "daily"
    assert client.post(
        "/api/reminders", json={"text": "x", "due_at": "not-a-date"}
    ).status_code == 400
    assert client.post(
        "/api/reminders", json={"text": "", "due_at": future}
    ).status_code == 400

    with SqlSession(engine()) as db:
        assert reminders.fire_due(db) == 1
    assert len(calls) == 1
    items = client.get("/api/reminders").json()
    assert len(items) == 1 and items[0]["status"] == "pending"

    assert client.put(
        f"/api/reminders/{created['id']}", json={"snooze_minutes": 10}
    ).status_code == 200
    assert client.put(
        f"/api/reminders/{created['id']}", json={"status": "done"}
    ).json()["status"] == "done"
    assert client.get("/api/reminders").json() == []
    assert len(client.get("/api/reminders", params={"include_done": "true"}).json()) == 1
    assert client.delete(f"/api/reminders/{created['id']}").status_code == 204


def test_remind_me_tool(client):
    from sqlmodel import Session as SqlSession

    from home.registry.db import engine
    from home.tools import reminders as reminder_tools
    from home.tools.registry import ProjectContext

    project = _mk_project(client)
    ctx = ProjectContext(
        project_id=project["id"],
        name=project["name"],
        repo_url=project["repo_url"],
        local_path=Path(project["local_path"]),
    )
    with SqlSession(engine()) as db:
        tools = {t.name: t for t in reminder_tools.make_tools(db)}
        created = tools["remind_me"].handler(
            ctx, {"text": "call mom", "due_at": "2030-01-01T09:00:00+00:00"}
        )
        assert created["project_id"] == project["id"]
        assert tools["reminder_list"].handler(ctx, {})[0]["text"] == "call mom"
        tools["reminder_cancel"].handler(ctx, {"id": created["id"]})
        assert tools["reminder_list"].handler(ctx, {}) == []


def test_briefing_digest_and_once_per_day(client, monkeypatch):
    import asyncio
    from datetime import datetime, timedelta, timezone

    from sqlmodel import Session as SqlSession

    from home import notify, scheduler
    from home.registry.db import engine

    project = _mk_project(client)
    client.post(
        f"/api/projects/{project['id']}/tasks", json={"title": "ship it", "status": "todo"}
    )
    past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    client.post("/api/reminders", json={"text": "ping", "due_at": past})
    client.put("/api/settings", json={"briefing_enabled": "1", "briefing_time": "00:00"})

    class FakeResp:
        status_code = 200
        text = "ok"

    messages = []
    monkeypatch.setattr(
        notify.httpx,
        "post",
        lambda url, **kw: messages.append(kw.get("content", b"").decode()) or FakeResp(),
    )
    monkeypatch.setenv("NTFY_TOPIC", "home")

    with SqlSession(engine()) as db:
        digest = scheduler._briefing_digest(db)
        assert "ship it" in digest and "ping" in digest
        asyncio.run(scheduler._maybe_send_briefing(db))
        asyncio.run(scheduler._maybe_send_briefing(db))  # guarded to once per day

    assert len(messages) == 1
    assert "ship it" in messages[0]


def test_web_fetch_ssrf_guard(client):
    from home import webfetch

    for blocked in (
        "http://127.0.0.1:8000/",
        "http://localhost:8080/",
        "file:///etc/passwd",
        "http://169.254.169.254/latest/meta-data/",
    ):
        with pytest.raises(webfetch.FetchError):
            webfetch.fetch(blocked)


def test_web_fetch_html_to_text(monkeypatch):
    from home import webfetch

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "text/html; charset=utf-8"}
        content = (
            b"<html><head><style>x</style></head><body><h1>Hi</h1>"
            b"<script>bad()</script><p>There</p></body></html>"
        )
        encoding = "utf-8"

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, headers=None):
            return FakeResponse()

    monkeypatch.setattr(webfetch.httpx, "Client", FakeClient)
    monkeypatch.setattr(webfetch, "_validate", lambda url: url)
    out = webfetch.fetch("https://example.com")
    assert "Hi" in out["text"] and "There" in out["text"]
    assert "bad()" not in out["text"]
    assert out["content_type"] == "text/html"


def test_watch_page_change_and_appear(client, monkeypatch):
    import asyncio

    from sqlmodel import Session as SqlSession

    from home import notify, watchers
    from home.registry.db import engine

    class FakeResp:
        status_code = 200
        text = "ok"

    calls = []
    monkeypatch.setattr(
        notify.httpx, "post", lambda url, **kw: calls.append(kw.get("content", b"").decode()) or FakeResp()
    )
    monkeypatch.setenv("NTFY_TOPIC", "home")

    page = {"text": "alpha beta"}
    monkeypatch.setattr(
        watchers.webfetch,
        "fetch",
        lambda url: {"text": page["text"], "content_type": "text/html", "url": url, "bytes": 10},
    )

    with SqlSession(engine()) as db:
        watch = watchers.create(db, "page", url="https://example.com", interval_minutes=30)
        asyncio.run(watchers.check(db, watch))  # baseline, silent
        assert calls == []
        page["text"] = "alpha beta gamma"
        asyncio.run(watchers.check(db, watch))
        assert len(calls) == 1
        assert watch.last_result == "changed"

        appear = watchers.create(
            db,
            "page",
            url="https://example.com/tickets",
            notify_on="appear",
            condition="In stock",
        )
        page["text"] = "Sold out"
        asyncio.run(watchers.check(db, appear))  # baseline
        page["text"] = "Sold out still"
        asyncio.run(watchers.check(db, appear))  # changed but no match
        assert len(calls) == 1
        page["text"] = "In stock now"
        asyncio.run(watchers.check(db, appear))
        assert len(calls) == 2
        assert appear.status == "done"


def test_watch_feed_new_items(client, monkeypatch):
    import asyncio

    from sqlmodel import Session as SqlSession

    from home import notify, watchers
    from home.registry.db import engine

    class FakeResp:
        status_code = 200
        text = "ok"

    calls = []
    monkeypatch.setattr(
        notify.httpx, "post", lambda url, **kw: calls.append(kw.get("content", b"").decode()) or FakeResp()
    )
    monkeypatch.setenv("NTFY_TOPIC", "home")

    rss = (
        "<rss><channel><item><title>One</title><guid>1</guid>"
        "<link>https://x/1</link></item></channel></rss>"
    )
    state = {"xml": rss}
    monkeypatch.setattr(
        watchers.webfetch,
        "fetch",
        lambda url: {"text": state["xml"], "content_type": "application/rss+xml", "url": url, "bytes": 10},
    )

    with SqlSession(engine()) as db:
        watch = watchers.create(db, "feed", url="https://x/feed")
        asyncio.run(watchers.check(db, watch))  # baseline
        assert calls == []
        state["xml"] = rss.replace(
            "</channel>",
            "<item><title>Two</title><guid>2</guid><link>https://x/2</link></item></channel>",
        )
        asyncio.run(watchers.check(db, watch))
        assert len(calls) == 1
        assert "Two" in calls[0]


def test_watch_condition(client, monkeypatch):
    import asyncio

    from sqlmodel import Session as SqlSession

    from home import notify, watchers
    from home.agent import loop as agent_loop
    from home.registry.db import engine

    project = _mk_project(client)
    provider = _mk_provider(client)
    client.post("/api/agents", json={"name": "chat", "provider_id": provider["id"]})

    async def fake_run_turn(ctx, client_, registry, messages, max_turns=10):
        yield {"type": "message", "content": "MET\nThe v2 release is published.", "tool_calls": []}

    monkeypatch.setattr(agent_loop, "run_turn", fake_run_turn)

    class FakeResp:
        status_code = 200
        text = "ok"

    calls = []
    monkeypatch.setattr(notify.httpx, "post", lambda url, **kw: calls.append(url) or FakeResp())
    monkeypatch.setenv("NTFY_TOPIC", "home")

    with SqlSession(engine()) as db:
        watch = watchers.create(
            db, "condition", condition="Is v2 published?", url="https://example.com"
        )
        asyncio.run(watchers.check(db, watch))
        assert watch.status == "done"
    assert len(calls) == 1


def test_watches_api(client):
    assert client.get("/api/watches").json() == []
    assert client.post("/api/watches", json={"kind": "page"}).status_code == 400
    created = client.post(
        "/api/watches",
        json={"kind": "page", "url": "https://example.com", "interval_minutes": 5},
    ).json()
    assert created["interval_minutes"] == 30
    assert client.put(
        f"/api/watches/{created['id']}", json={"status": "paused"}
    ).json()["status"] == "paused"
    assert client.delete(f"/api/watches/{created['id']}").status_code == 204
    assert client.put("/api/watches/999", json={"status": "paused"}).status_code == 404


def test_ask_approval_and_write_gate(client, monkeypatch):
    from sqlmodel import Session as SqlSession

    from home import questions as questions_mod
    from home.agent.loop import AgentPause
    from home.registry.db import engine
    from home.registry.models import Question
    from home.registry.models import Session as ChatSession
    from home.tools import gitwrites
    from home.tools import questions as question_tools
    from home.tools.registry import ProjectContext

    project = _mk_project(client)
    pid = project["id"]
    client.put(f"/api/projects/{pid}/git-writes", json={"enabled": True})
    updated = client.put(
        f"/api/projects/{pid}", json={"require_write_approval": True}
    ).json()
    assert updated["require_write_approval"] is True

    ctx = ProjectContext(
        project_id=pid,
        name=project["name"],
        repo_url=project["repo_url"],
        local_path=Path(project["local_path"]),
    )
    with SqlSession(engine()) as db:
        chat = ChatSession(project_id=pid, title="approval")
        db.add(chat)
        db.commit()
        db.refresh(chat)
        ctx.session_id = chat.id
        tools = {t.name: t for t in question_tools.make_tools(db)}
        with pytest.raises(AgentPause) as exc:
            tools["ask_approval"].handler(
                ctx, {"action": "git_push", "summary": "Push the feature branch"}
            )
        assert exc.value.payload["kind"] == "approval"
        assert exc.value.payload["options"] == ["approve", "deny"]

        # hard gate: no approved request yet
        with pytest.raises(PermissionError):
            gitwrites._push(ctx, {}, db)

        question = db.get(Question, exc.value.payload["id"])
        questions_mod.answer(db, question, "approve")

        monkeypatch.setattr(gitwrites, "_git", lambda *args, **kwargs: "pushed")
        result = gitwrites._push(ctx, {}, db)
        assert result["output"] == "pushed"


def test_chat_approval_event(client, monkeypatch):
    from home.agent import loop as agent_loop
    from home.agent.loop import AgentPause

    project = _mk_project(client)
    provider = _mk_provider(client)

    async def fake_run_turn(ctx, client_, registry, messages, max_turns=10):
        try:
            registry.get("ask_approval").handler(
                ctx, {"action": "gh_open_pr", "summary": "Open the PR"}
            )
        except AgentPause as pause:
            yield {"type": "question", **pause.payload}
            return
        yield {"type": "message", "content": "no approval", "tool_calls": []}

    monkeypatch.setattr(agent_loop, "run_turn", fake_run_turn)
    resp = client.post(
        f"/api/projects/{project['id']}/chat",
        json={"message": "ship it", "provider_id": provider["id"]},
    )
    assert resp.status_code == 200
    assert '"kind": "approval"' in resp.text
    sid = client.get(f"/api/projects/{project['id']}/sessions").json()[0]["id"]
    questions = client.get(f"/api/sessions/{sid}/questions").json()
    assert questions[0]["kind"] == "approval"
    assert questions[0]["meta"] == {"action": "gh_open_pr"}


def test_suggest_next_work(client, monkeypatch):
    from home.agent import loop as agent_loop

    project = _mk_project(client)
    provider = _mk_provider(client)

    async def fake_run_turn(ctx, client_, registry, messages, max_turns=10):
        registry.get("task_create").handler(
            ctx,
            {
                "title": "Add caching",
                "acceptance": "cache hit rate over 50%",
                "priority": "high",
                "source": "suggested",
            },
        )
        yield {"type": "message", "content": "Proposed 1 task.", "tool_calls": []}

    monkeypatch.setattr(agent_loop, "run_turn", fake_run_turn)
    resp = client.post(
        f"/api/projects/{project['id']}/tasks/suggest",
        json={"provider_id": provider["id"]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["report"] == "Proposed 1 task."
    assert len(body["task_ids"]) == 1
    tasks = client.get(f"/api/projects/{project['id']}/tasks").json()
    assert tasks[0]["source"] == "suggested"

    assert client.post(f"/api/projects/{project['id']}/tasks/suggest", json={}).status_code == 400


def test_github_token_storage_and_status(client, monkeypatch):
    from home import github_auth

    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    assert client.get("/api/github/status").json()["connected"] is False

    class FakeResp:
        status_code = 200
        headers = {"x-oauth-scopes": "repo, read:org"}

        def json(self):
            return {"login": "octocat", "name": "Mona", "avatar_url": "https://a"}

        def raise_for_status(self):
            return None

    monkeypatch.setattr(github_auth.httpx, "get", lambda url, **kw: FakeResp())
    resp = client.post("/api/github/token", json={"token": "ghp_x"}).json()
    assert resp["connected"] is True and resp["login"] == "octocat"
    assert github_auth.load_token() == "ghp_x"

    status = client.get("/api/github/status").json()
    assert status["source"] == "stored"
    assert status["scopes"] == ["repo", "read:org"]

    # env var takes precedence
    monkeypatch.setenv("GITHUB_TOKEN", "env-token")
    assert client.get("/api/github/status").json()["source"] == "env"

    class BadResp(FakeResp):
        status_code = 401

    monkeypatch.setattr(github_auth.httpx, "get", lambda url, **kw: BadResp())
    assert client.post("/api/github/token", json={"token": "bad"}).status_code == 400

    monkeypatch.delenv("GITHUB_TOKEN")
    client.delete("/api/github/token")
    assert github_auth.load_token() is None


def test_github_import_gh(client, monkeypatch):
    from types import SimpleNamespace

    from home import github_auth

    monkeypatch.delenv("GITHUB_TOKEN", raising=False)

    class FakeResp:
        status_code = 200
        headers = {}

        def json(self):
            return {"login": "octocat", "name": None, "avatar_url": None}

        def raise_for_status(self):
            return None

    monkeypatch.setattr(github_auth.httpx, "get", lambda url, **kw: FakeResp())
    monkeypatch.setattr(github_auth, "gh_cli_available", lambda: True)
    monkeypatch.setattr(
        github_auth.subprocess,
        "run",
        lambda *a, **k: SimpleNamespace(returncode=0, stdout="ghp_gh\n"),
    )
    assert client.post("/api/github/import-gh").json()["login"] == "octocat"
    assert github_auth.load_token() == "ghp_gh"

    monkeypatch.setattr(
        github_auth.subprocess,
        "run",
        lambda *a, **k: SimpleNamespace(returncode=1, stdout=""),
    )
    assert client.post("/api/github/import-gh").status_code == 400


def test_clone_auth_args(client, monkeypatch):
    from home.routers import projects

    monkeypatch.setattr(projects.config, "github_token", lambda: "tok")
    assert projects._auth_args("https://github.com/a/b.git") == [
        "-c",
        "http.extraheader=Authorization: Bearer tok",
    ]
    assert projects._auth_args("/tmp/local/repo") == []

    monkeypatch.setattr(projects.config, "github_token", lambda: None)
    assert projects._auth_args("https://github.com/a/b.git") == []


def test_project_delete_cascade(client):
    from sqlmodel import Session as SqlSession
    from sqlmodel import select as sqlselect

    from home.registry.db import engine
    from home.registry.models import (
        Goal,
        InboxItem,
        Message,
        Milestone,
        Project,
        Reminder,
        Schedule,
        Task,
        TaskComment,
        Usage,
        Watch,
    )
    from home.registry.models import Session as ChatSession

    alpha = _mk_project(client, name="alpha")
    beta = _mk_project(client, name="beta")
    ws_alpha = config.workspace_dir("alpha")
    ws_beta = config.workspace_dir("beta")
    (ws_alpha / "plan.md").write_text("x")
    (ws_beta / "keep.md").write_text("x")
    repos_alpha = config.data_dir() / "repos" / "alpha"
    repos_beta = config.data_dir() / "repos" / "beta"

    task = client.post(f"/api/projects/{alpha['id']}/tasks", json={"title": "t"}).json()
    client.post(f"/api/tasks/{task['id']}/comments", json={"body": "note"})
    client.post(f"/api/projects/{alpha['id']}/goals", json={"title": "g"})
    client.post(f"/api/projects/{alpha['id']}/milestones", json={"title": "m"})
    client.post(
        f"/api/projects/{alpha['id']}/schedules",
        json={"action": "chat", "instruction": "x"},
    )
    client.post(
        "/api/reminders",
        json={"text": "r", "due_at": "2030-01-01T00:00:00+00:00", "project_id": alpha["id"]},
    )
    client.post(
        "/api/watches",
        json={"kind": "page", "url": "https://example.com", "project_id": alpha["id"]},
    )
    with SqlSession(engine()) as db:
        chat = ChatSession(project_id=alpha["id"], title="s")
        db.add(chat)
        db.commit()
        db.refresh(chat)
        session_id = chat.id
        db.add(Message(session_id=session_id, role="user", content="hi"))
        db.add(InboxItem(project_id=alpha["id"], kind="pr", external_id="pr:1", title="x"))
        db.add(Usage(project_id=alpha["id"], action="chat", prompt_tokens=5))
        db.commit()

    client.post(f"/api/projects/{beta['id']}/tasks", json={"title": "keep"})

    assert client.delete(f"/api/projects/{alpha['id']}").status_code == 204

    with SqlSession(engine()) as db:
        for model in (Task, Goal, Milestone, Schedule, Reminder, Watch, InboxItem, Usage, ChatSession):
            assert db.exec(sqlselect(model).where(model.project_id == alpha["id"])).all() == [], model.__name__
        assert db.exec(sqlselect(Message).where(Message.session_id == session_id)).all() == []
        assert db.exec(sqlselect(TaskComment).where(TaskComment.task_id == task["id"])).all() == []
        assert db.get(Project, alpha["id"]) is None
        assert len(db.exec(sqlselect(Task).where(Task.project_id == beta["id"])).all()) == 1

    assert not repos_alpha.exists()
    assert not ws_alpha.exists()
    assert repos_beta.exists()
    assert ws_beta.exists()
    assert (ws_beta / "keep.md").exists()


def test_chat_rejects_foreign_session(client):
    from sqlmodel import Session as SqlSession
    from sqlmodel import select as sqlselect

    from home.registry.db import engine
    from home.registry.models import Message
    from home.registry.models import Session as ChatSession

    alpha = _mk_project(client, name="aa")
    beta = _mk_project(client, name="bb")
    provider = _mk_provider(client)
    with SqlSession(engine()) as db:
        chat = ChatSession(project_id=alpha["id"], title="a session")
        db.add(chat)
        db.commit()
        db.refresh(chat)
        session_id = chat.id

    resp = client.post(
        f"/api/projects/{beta['id']}/chat",
        json={"message": "hi", "session_id": session_id, "provider_id": provider["id"]},
    )
    assert resp.status_code == 404
    with SqlSession(engine()) as db:
        assert db.exec(sqlselect(Message).where(Message.session_id == session_id)).all() == []


def test_goal_action_persists_on_session(client, monkeypatch):
    from sqlmodel import Session as SqlSession

    from home.registry.db import engine
    from home.registry.models import Session as ChatSession
    from home.routers import chat as chat_router

    project = _mk_project(client)
    provider = _mk_provider(client)
    goal = client.post(
        f"/api/projects/{project['id']}/goals", json={"title": "Ship it"}
    ).json()
    discussed = client.post(f"/api/goals/{goal['id']}/discuss").json()
    session_id = discussed["session_id"]

    with SqlSession(engine()) as db:
        assert db.get(ChatSession, session_id).action == "goal"

    seen = {}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def stream_chat(self, messages, tools=None):
            seen["system"] = messages[0]["content"]
            yield {"choices": [{"delta": {"content": "ok"}}]}

    monkeypatch.setattr(chat_router, "OpenAIClient", FakeClient)
    resp = client.post(
        f"/api/projects/{project['id']}/chat",
        json={"message": "continue", "session_id": session_id, "provider_id": provider["id"]},
    )
    assert resp.status_code == 200
    assert "Goal mode" in seen["system"]


def test_chat_persists_tool_history(client, monkeypatch):
    import json as jsonlib

    from home.agent import loop as agent_loop

    project = _mk_project(client)
    provider = _mk_provider(client)
    captured = {}
    calls = {"n": 0}

    async def fake_run_turn(ctx, client_, registry, messages, max_turns=10):
        calls["n"] += 1
        if calls["n"] == 1:
            yield {"type": "token", "text": "checking "}
            yield {
                "type": "message",
                "content": "checking",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "read_agents_md", "arguments": "{}"},
                    }
                ],
            }
            yield {"type": "tool_call", "id": "call_1", "name": "read_agents_md", "arguments": {}}
            yield {
                "type": "tool_result",
                "id": "call_1",
                "name": "read_agents_md",
                "ok": True,
                "preview": '"# demo"',
            }
            yield {"type": "message", "content": "Done.", "tool_calls": []}
        else:
            captured["messages"] = messages
            yield {"type": "message", "content": "Again.", "tool_calls": []}

    monkeypatch.setattr(agent_loop, "run_turn", fake_run_turn)

    resp = client.post(
        f"/api/projects/{project['id']}/chat",
        json={"message": "read it", "provider_id": provider["id"]},
    )
    assert resp.status_code == 200
    session_id = client.get(f"/api/projects/{project['id']}/sessions").json()[0]["id"]
    rows = client.get(f"/api/sessions/{session_id}/messages").json()
    assert [r["role"] for r in rows] == ["user", "assistant", "tool", "assistant"]
    assert jsonlib.loads(rows[1]["tool_calls"])[0]["id"] == "call_1"
    assert rows[2]["tool_call_id"] == "call_1"
    assert rows[2]["name"] == "read_agents_md"
    assert rows[2]["ok"] is True
    assert rows[3]["content"] == "Done."

    # the next turn replays valid assistant/tool pairs to the provider
    resp = client.post(
        f"/api/projects/{project['id']}/chat",
        json={"message": "again", "session_id": session_id, "provider_id": provider["id"]},
    )
    assert resp.status_code == 200
    sent = captured["messages"]
    assert any(m.get("tool_calls") for m in sent if m["role"] == "assistant")
    tool_rows = [m for m in sent if m["role"] == "tool"]
    assert tool_rows and tool_rows[0]["tool_call_id"] == "call_1"


def test_chat_heartbeat(client, monkeypatch):
    import asyncio

    from home.agent import loop as agent_loop
    from home.routers import chat as chat_router

    project = _mk_project(client)
    provider = _mk_provider(client)

    async def slow_run_turn(ctx, client_, registry, messages, max_turns=10):
        await asyncio.sleep(0.5)
        yield {"type": "message", "content": "late", "tool_calls": []}

    monkeypatch.setattr(agent_loop, "run_turn", slow_run_turn)
    monkeypatch.setattr(chat_router, "HEARTBEAT_SECONDS", 0.1)
    resp = client.post(
        f"/api/projects/{project['id']}/chat",
        json={"message": "slow", "provider_id": provider["id"]},
    )
    assert resp.status_code == 200
    assert ": ping" in resp.text
    assert "late" in resp.text


def test_chat_usage_tracking(client, monkeypatch):
    from home.routers import chat as chat_router

    project = _mk_project(client)
    provider = _mk_provider(client)

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def stream_chat(self, messages, tools=None):
            yield {"choices": [{"delta": {"content": "hello "}}]}
            yield {"choices": [{"delta": {"content": "world"}}]}
            yield {"choices": [], "usage": {"prompt_tokens": 11, "completion_tokens": 5}}

    monkeypatch.setattr(chat_router, "OpenAIClient", FakeClient)

    resp = client.post(
        f"/api/projects/{project['id']}/chat",
        json={"message": "hi", "provider_id": provider["id"]},
    )
    assert resp.status_code == 200, resp.text
    assert "hello" in resp.text

    data = client.get(f"/api/projects/{project['id']}/usage").json()
    assert data["total"] == {
        "prompt_tokens": 11,
        "completion_tokens": 5,
        "tokens": 16,
        "runs": 1,
    }
    assert data["by_action"][0]["action"] == "chat"
    assert data["by_session"][0]["tokens"] == 16
    assert data["by_session"][0]["title"] == "hi"

    assert client.get("/api/projects/999/usage").status_code == 404


def test_schedules_crud_and_run(client, monkeypatch):
    from datetime import datetime, timedelta, timezone

    from sqlmodel import Session as SqlSession

    from home import scheduler
    from home.registry.db import engine
    from home.registry.models import Schedule

    project = _mk_project(client)
    pid = project["id"]
    provider = _mk_provider(client)
    client.post("/api/agents", json={"name": "github-scan", "provider_id": provider["id"]})

    assert client.get(f"/api/projects/{pid}/schedules").json() == []
    assert client.post(
        f"/api/projects/{pid}/schedules", json={"action": "nope"}
    ).status_code == 400

    sched = client.post(
        f"/api/projects/{pid}/schedules",
        json={"action": "github-scan", "instruction": "Summarize today ({date})", "interval_minutes": 5},
    ).json()
    assert sched["enabled"] is True and sched["last_run_at"] is None

    updated = client.put(
        f"/api/schedules/{sched['id']}", json={"enabled": False, "interval_minutes": 0}
    ).json()
    assert updated["enabled"] is False and updated["interval_minutes"] == 1

    with SqlSession(engine()) as db:
        # not due right after creation; due once the interval has passed
        assert scheduler.due_schedules(db) == []
        row = db.get(Schedule, sched["id"])
        row.enabled = True
        row.last_run_at = datetime.now(timezone.utc) - timedelta(minutes=10)
        db.add(row)
        db.commit()
        assert [s.id for s in scheduler.due_schedules(db)] == [sched["id"]]

    from home.agent import loop as agent_loop

    seen = {}

    async def fake_run_turn(ctx, client_, registry, messages, max_turns=10):
        seen["instruction"] = messages[-1]["content"]
        yield {"type": "message", "content": "Digest written.", "tool_calls": []}

    monkeypatch.setattr(agent_loop, "run_turn", fake_run_turn)

    result = client.post(f"/api/schedules/{sched['id']}/run").json()
    assert result["last_status"] == "ok"
    assert result["last_report"] == "Digest written."
    assert result["last_run_at"]
    assert "{" not in seen["instruction"] and "(" in seen["instruction"]

    assert client.delete(f"/api/schedules/{sched['id']}").status_code == 204
    assert client.post(f"/api/schedules/{sched['id']}/run").status_code == 404


def test_preferences_crud(client):
    assert client.get("/api/settings/preferences").json() == {"preferences": []}
    assert client.post("/api/settings/preferences", json={"text": ""}).status_code == 400

    added = client.post(
        "/api/settings/preferences", json={"text": "Never use em dashes."}
    ).json()
    assert added["preferences"] == ["Never use em dashes."]

    again = client.post(
        "/api/settings/preferences", json={"text": "Never use em dashes."}
    ).json()
    assert again["preferences"] == ["Never use em dashes."]

    client.post("/api/settings/preferences", json={"text": "Be concise."})
    assert client.delete("/api/settings/preferences/0").json()["preferences"] == [
        "Be concise."
    ]
    assert client.delete("/api/settings/preferences/9").json()["preferences"] == [
        "Be concise."
    ]


def test_preferences_in_prompt(client, monkeypatch):
    from home.routers import chat as chat_router

    project = _mk_project(client)
    provider = _mk_provider(client)
    client.post("/api/settings/preferences", json={"text": "Never use em dashes."})
    seen = {}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def stream_chat(self, messages, tools=None):
            seen["system"] = messages[0]["content"]
            yield {"choices": [{"delta": {"content": "ok"}}]}

    monkeypatch.setattr(chat_router, "OpenAIClient", FakeClient)
    resp = client.post(
        f"/api/projects/{project['id']}/chat",
        json={"message": "hi", "provider_id": provider["id"]},
    )
    assert resp.status_code == 200
    assert "Standing preferences" in seen["system"]
    assert "Never use em dashes." in seen["system"]


def test_project_preference_memory_always_in_context(client):
    from home import totem_store

    project = _mk_project(client)
    path = Path(project["local_path"])
    totem_store.create(
        path,
        type="observation",
        title="House style",
        statement="Never use em dashes.",
        tags=["preference"],
        metadata={"observation": "house_style"},
    )
    totem_store.create(
        path,
        type="observation",
        title="Client Acme",
        statement="Acme uses SSO.",
        tags=["client:acme"],
        metadata={"observation": "client_fact"},
    )
    context = totem_store.digest(path, task="anything").get("context", "")
    assert "Never use em dashes." in context
    assert "Acme uses SSO." in context


def test_background_task_lifecycle(client, monkeypatch):
    import asyncio

    from sqlmodel import Session as SqlSession, select

    from home import jobs
    from home.registry.db import engine
    from home.registry.models import BackgroundTask, Message
    from home.registry.models import Session as ChatSession

    project = _mk_project(client)
    with SqlSession(engine()) as db:
        cs = ChatSession(project_id=project["id"], title="bg")
        db.add(cs)
        db.commit()
        db.refresh(cs)
        sid = cs.id

    monkeypatch.setattr(jobs.manager, "enqueue", lambda job_id: None)

    async def fake_exec(db, job, project_obj):
        return "did the thing", None, {}

    monkeypatch.setattr(jobs, "_execute_job", fake_exec)

    job_id = jobs.submit(
        project_id=project["id"],
        session_id=sid,
        kind="agent",
        instruction="do it",
        description="test job",
        action="chat",
    )
    asyncio.run(jobs.manager._run(job_id))

    with SqlSession(engine()) as db:
        job = db.get(BackgroundTask, job_id)
        assert job.status == "completed"
        assert job.result == "did the thing"
        assert job.notified is True
        notes = db.exec(
            select(Message).where(
                Message.session_id == sid, Message.role == "notification"
            )
        ).all()
        assert notes and "task.completed" in notes[0].content


def test_background_stop_and_reconcile(client, monkeypatch):
    from sqlmodel import Session as SqlSession, select

    from home import jobs
    from home.registry.db import engine
    from home.registry.models import BackgroundTask

    project = _mk_project(client)
    monkeypatch.setattr(jobs.manager, "enqueue", lambda job_id: None)

    job_id = jobs.submit(
        project_id=project["id"],
        session_id=None,
        kind="agent",
        instruction="x",
        description="y",
    )
    stopped = jobs.stop(job_id)
    assert stopped["status"] == "stopped"

    with SqlSession(engine()) as db:
        db.add(
            BackgroundTask(
                project_id=project["id"],
                kind="agent",
                status="running",
                instruction="x",
                description="y",
            )
        )
        db.commit()

    jobs._reconcile()
    with SqlSession(engine()) as db:
        lost = db.exec(
            select(BackgroundTask).where(BackgroundTask.status == "lost")
        ).all()
        assert any(j.project_id == project["id"] for j in lost)


def test_run_subagent_background_returns_job(client, monkeypatch):
    from sqlmodel import Session as SqlSession, select

    from home import jobs
    from home.registry.db import engine
    from home.registry.models import BackgroundTask, Project
    from home.tools import subagents
    from home.tools.registry import ProjectContext

    project = _mk_project(client)
    provider = _mk_provider(client)
    client.post(
        "/api/agents",
        json={"name": "explore", "provider_id": provider["id"], "tools": ["repo"], "max_turns": 2},
    )
    monkeypatch.setattr(jobs.manager, "enqueue", lambda job_id: None)

    with SqlSession(engine()) as db:
        project_obj = db.get(Project, project["id"])
        ctx = ProjectContext.from_project(project_obj)
        registry_tools = {t.name: t for t in subagents.make_tools(db)}
        result = registry_tools["run_subagent"].handler(
            ctx,
            {"action": "explore", "task": "look around", "run_in_background": True, "description": "bg look"},
        )
        assert result["status"] == "queued"
        job = db.get(BackgroundTask, result["job_id"])
        assert job.kind == "subagent" and job.action == "explore"


def test_task_due_date_roundtrip_and_at_risk(client):
    from datetime import datetime, timedelta, timezone

    from sqlmodel import Session as SqlSession

    from home import taskboard
    from home.registry.db import engine

    project = _mk_project(client)
    pid = project["id"]
    past = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
    far = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()

    overdue = client.post(
        f"/api/projects/{pid}/tasks", json={"title": "ship it", "due_at": past}
    ).json()
    assert overdue["due_at"].startswith(past)

    client.post(
        f"/api/projects/{pid}/tasks", json={"title": "later", "due_at": far}
    )

    with SqlSession(engine()) as db:
        risky = taskboard.at_risk(db, pid)
        assert [t.id for t in risky] == [overdue["id"]]

    cleared = client.put(f"/api/tasks/{overdue['id']}", json={"due_at": ""}).json()
    assert cleared["due_at"] is None


def test_schedule_agent_tools(client):
    from sqlmodel import Session as SqlSession, select

    from home.registry.db import engine
    from home.registry.models import Project, Schedule
    from home.tools import schedules as schedule_tools
    from home.tools.registry import ProjectContext

    project = _mk_project(client)
    with SqlSession(engine()) as db:
        project_obj = db.get(Project, project["id"])
        ctx = ProjectContext.from_project(project_obj)
        tools = {t.name: t for t in schedule_tools.make_tools(db)}
        created = tools["schedule_create"].handler(
            ctx,
            {"instruction": "Check the feed every Friday", "interval_minutes": 10080},
        )
        assert created["interval_minutes"] == 10080
        listed = tools["schedule_list"].handler(ctx, {})
        assert any(s["id"] == created["id"] for s in listed)
        tools["schedule_cancel"].handler(ctx, {"id": created["id"]})
        assert db.exec(
            select(Schedule).where(Schedule.project_id == project["id"])
        ).all() == []


def test_event_trigger_matching_and_run(client, monkeypatch):
    import asyncio

    from sqlmodel import Session as SqlSession, select

    from home import events, scheduler
    from home.registry.db import engine
    from home.registry.models import Event, Project, Schedule

    project = _mk_project(client)
    pid = project["id"]
    provider = _mk_provider(client)

    with SqlSession(engine()) as db:
        row = db.get(Project, pid)
        row.default_provider_id = provider["id"]
        db.add(row)
        db.commit()
        db.add(
            Schedule(
                project_id=pid,
                action="chat",
                instruction="Handle {event}: {event_title}",
                trigger="event",
                event="ci_failure",
            )
        )
        db.add(
            Schedule(
                project_id=pid,
                action="chat",
                instruction="never",
                trigger="event",
                event="pr_opened",
            )
        )
        db.commit()
        events.emit(db, pid, "ci_failure", {"title": "CI broken", "url": "http://x"}, key="run:1")
        events.emit(db, pid, "ci_failure", {"title": "CI broken", "url": "http://x"}, key="run:1")
        db.commit()
        assert len(db.exec(select(Event).where(Event.project_id == pid)).all()) == 1
        plan, handle_ids = scheduler._event_plan(db)
        assert len(plan) == 1
        assert plan[0][1]["payload"]["title"] == "CI broken"
        assert handle_ids

    from home.agent import loop as agent_loop

    seen = {}

    async def fake_run_turn(ctx, client_, registry, messages, max_turns=10):
        seen["instruction"] = messages[-1]["content"]
        yield {"type": "message", "content": "handled", "tool_calls": []}

    monkeypatch.setattr(agent_loop, "run_turn", fake_run_turn)

    result = asyncio.run(scheduler.run_schedule(plan[0][0], event=plan[0][1]))
    assert result["last_status"] == "ok", result.get("last_report")
    assert "CI broken" in seen["instruction"]


def test_task_transition_emits_event(client):
    from sqlmodel import Session as SqlSession, select

    from home.registry.db import engine
    from home.registry.models import Event

    project = _mk_project(client)
    pid = project["id"]
    task = client.post(f"/api/projects/{pid}/tasks", json={"title": "review me"}).json()
    client.put(f"/api/tasks/{task['id']}", json={"status": "review"})
    with SqlSession(engine()) as db:
        rows = db.exec(
            select(Event).where(Event.project_id == pid, Event.kind == "task_review")
        ).all()
        assert rows and rows[0].key == f"task:{task['id']}:review"


def test_inbox_poll_emits_ci_event(client, monkeypatch):
    from sqlmodel import Session as SqlSession, select

    from home import overview
    from home.registry.db import engine
    from home.registry.models import Event

    project = _mk_project(client)
    runs = [{"id": 99, "name": "CI", "conclusion": "failure", "url": "u"}]
    monkeypatch.setattr(
        overview,
        "github_list",
        lambda p, kind, state="open", limit=30: {
            "available": True,
            "repo": "a/b",
            "items": runs if kind == "runs" else [],
        },
    )
    monkeypatch.setattr(overview, "repo_slug", lambda url: "a/b")

    client.post("/api/inbox/poll")  # baseline
    runs.append({"id": 100, "name": "CI", "conclusion": "failure", "url": "u2"})
    client.post("/api/inbox/poll")

    with SqlSession(engine()) as db:
        rows = db.exec(
            select(Event).where(
                Event.project_id == project["id"], Event.kind == "ci_failure"
            )
        ).all()
        assert any(e.key == "run:100" for e in rows)


def test_daily_plan_and_weekly_review_gates(client, monkeypatch):
    import asyncio

    from sqlmodel import Session as SqlSession

    from home import notify, scheduler, settings
    from home.registry.db import engine

    _mk_project(client)
    calls = []
    monkeypatch.setattr(notify, "send", lambda *a, **k: calls.append(a))

    client.put(
        "/api/settings",
        json={
            "daily_plan_enabled": "1",
            "daily_plan_time": "00:00",
            "weekly_review_enabled": "1",
            "weekly_review_time": "00:00",
        },
    )
    with SqlSession(engine()) as db:
        day = settings.local_now(db).weekday()
    client.put("/api/settings", json={"weekly_review_day": str(day)})

    with SqlSession(engine()) as db:
        asyncio.run(scheduler._maybe_send_daily_plan(db))
        asyncio.run(scheduler._maybe_send_daily_plan(db))
    assert len([c for c in calls if c[0] == "Daily plan"]) == 1

    with SqlSession(engine()) as db:
        asyncio.run(scheduler._maybe_send_weekly_review(db))
        asyncio.run(scheduler._maybe_send_weekly_review(db))
    assert len([c for c in calls if c[0] == "Weekly review"]) == 1

    assert client.put("/api/settings", json={"weekly_review_time": "25:00"}).status_code == 400
    assert client.put("/api/settings", json={"weekly_review_day": "9"}).status_code == 400


def test_capture_endpoint(client, monkeypatch):
    from home.routers import capture as capture_router

    project = _mk_project(client)
    provider = _mk_provider(client)
    seen = {}

    async def fake_run_once(project_, provider_, system, user, groups="", max_turns=8, tasks_db=None):
        seen["system"] = system
        seen["user"] = user
        seen["groups"] = groups
        return "Created task #5 and memory 'Acme'.", None, {}

    monkeypatch.setattr(capture_router, "run_once", fake_run_once)
    resp = client.post(
        f"/api/projects/{project['id']}/capture",
        json={"text": "Call Acme about renewal tomorrow.", "provider_id": provider["id"]},
    )
    assert resp.status_code == 200
    assert "Acme" in resp.json()["report"]
    assert "task_create" in seen["system"] and "remind_me" in seen["system"]
    assert "tasks" in seen["groups"]

    assert (
        client.post(
            f"/api/projects/{project['id']}/capture",
            json={"text": "   ", "provider_id": provider["id"]},
        ).status_code
        == 400
    )


def test_run_once_registers_db_tools(client, monkeypatch):
    import asyncio

    from sqlmodel import Session as SqlSession

    from home.agent import run as run_mod
    from home.registry.db import engine
    from home.registry.models import Project, Provider

    project = _mk_project(client)
    provider = _mk_provider(client)
    seen = {}

    async def fake_run_turn(ctx, client_, registry, messages, max_turns=10):
        seen["tools"] = [t.name for t in registry.all()]
        yield {"type": "message", "content": "ok", "tool_calls": []}

    monkeypatch.setattr(run_mod.agent_loop, "run_turn", fake_run_turn)
    with SqlSession(engine()) as db:
        report, error, tokens = asyncio.run(
            run_mod.run_once(
                db.get(Project, project["id"]),
                db.get(Provider, provider["id"]),
                "sys",
                "user",
                groups="tasks,reminders,watches,automations",
                tasks_db=db,
            )
        )
    assert error is None
    for name in ("task_create", "remind_me", "watch_add", "schedule_create"):
        assert name in seen["tools"]


def test_implement_requires_git_writes(client):
    project = _mk_project(client)
    task = client.post(
        f"/api/projects/{project['id']}/tasks", json={"title": "do it"}
    ).json()
    assert client.post(f"/api/tasks/{task['id']}/implement").status_code == 403


def test_run_next_picks_ready_task(client, monkeypatch):
    from sqlmodel import Session as SqlSession, select

    from home import jobs
    from home.registry.db import engine
    from home.registry.models import BackgroundTask, Task

    project = _mk_project(client)
    pid = project["id"]
    client.put(f"/api/projects/{pid}/git-writes", json={"enabled": True})
    monkeypatch.setattr(jobs.manager, "enqueue", lambda job_id: None)

    dep = client.post(f"/api/projects/{pid}/tasks", json={"title": "dep"}).json()
    low = client.post(
        f"/api/projects/{pid}/tasks",
        json={"title": "low ready", "status": "todo", "priority": "low"},
    ).json()
    high = client.post(
        f"/api/projects/{pid}/tasks",
        json={"title": "high ready", "status": "todo", "priority": "high"},
    ).json()
    blocked = client.post(
        f"/api/projects/{pid}/tasks",
        json={"title": "blocked", "status": "todo", "priority": "high", "depends_on": [dep["id"]]},
    ).json()

    result = client.post(f"/api/projects/{pid}/tasks/run-next").json()
    assert result["task_id"] == high["id"], result

    with SqlSession(engine()) as db:
        job = db.get(BackgroundTask, result["job_id"])
        assert job.kind == "agent" and job.action == "implement"
        assert db.get(Task, high["id"]).status == "doing"
        assert db.get(Task, blocked["id"]).status == "todo"


def test_task_pr_url_roundtrip(client):
    project = _mk_project(client)
    task = client.post(
        f"/api/projects/{project['id']}/tasks", json={"title": "pr task"}
    ).json()
    updated = client.put(
        f"/api/tasks/{task['id']}", json={"pr_url": "https://github.com/a/b/pull/7"}
    ).json()
    assert updated["pr_url"] == "https://github.com/a/b/pull/7"


def test_user_memory_tools(client):
    from sqlmodel import Session as SqlSession

    from home.registry.db import engine
    from home.registry.models import Project
    from home.tools import preferences as pref_tools
    from home.tools.registry import ProjectContext

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


def test_user_note_in_chat_prompt(client, monkeypatch):
    from home.routers import chat as chat_router

    project = _mk_project(client)
    provider = _mk_provider(client)
    seen = {}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def stream_chat(self, messages, tools=None):
            seen["system"] = messages[0]["content"]
            yield {"choices": [{"delta": {"content": "ok"}}]}

    monkeypatch.setattr(chat_router, "OpenAIClient", FakeClient)
    client.post(
        f"/api/projects/{project['id']}/chat",
        json={"message": "call me Sam", "provider_id": provider["id"]},
    )
    assert "About the owner" in seen["system"]
    assert "set_owner_name" in seen["system"]
    assert "remember_preference" in seen["system"]


def test_preference_edit(client):
    client.post("/api/settings/preferences", json={"text": "one"})
    client.post("/api/settings/preferences", json={"text": "two"})
    updated = client.put("/api/settings/preferences/1", json={"text": "TWO"}).json()
    assert updated["preferences"] == ["one", "TWO"]
    assert client.put("/api/settings/preferences/1", json={"text": "  "}).status_code == 400


def test_create_project_stream(client):
    import json
    import subprocess
    import tempfile

    src = tempfile.mkdtemp()
    subprocess.run(["git", "init", "-q"], cwd=src, check=True)
    (Path(src) / "README.md").write_text("# demo\n")
    subprocess.run(["git", "add", "."], cwd=src, check=True)
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "i"],
        cwd=src,
        check=True,
    )

    resp = client.post("/api/projects/stream", json={"name": "streamed", "repo_url": src})
    assert resp.status_code == 200, resp.text
    events = [
        json.loads(line[len("data:") :].strip())
        for line in resp.text.splitlines()
        if line.startswith("data:")
    ]
    assert any(
        e["event"] == "step" and e["step"] == "clone" and e.get("status") == "done"
        for e in events
    )
    done = next(e for e in events if e["event"] == "done")
    assert done["project"]["name"] == "streamed"
    assert client.get("/api/projects").json()[0]["name"] == "streamed"


def test_create_project_stream_duplicate(client):
    project = _mk_project(client, name="dup")
    src = project["repo_url"]
    resp = client.post("/api/projects/stream", json={"name": "dup", "repo_url": src})
    assert resp.status_code == 200
    assert '"event": "error"' in resp.text


def test_skills_install_list_read_remove(client, tmp_path):
    src = tmp_path / "my-skill"
    src.mkdir()
    (src / "SKILL.md").write_text(
        "---\nname: PDF Tools\ndescription: Extract text from PDFs.\n---\n"
        "# PDF Tools\nUse pdftotext to extract.\n"
    )

    resp = client.post("/api/skills/install", json={"source": str(src)})
    assert resp.status_code == 201, resp.text
    installed = resp.json()
    assert installed[0]["name"] == "PDF Tools"
    assert installed[0]["description"] == "Extract text from PDFs."
    slug = installed[0]["slug"]

    assert [s["slug"] for s in client.get("/api/skills").json()] == [slug]
    detail = client.get(f"/api/skills/{slug}").json()
    assert "pdftotext" in detail["body"]

    assert client.delete(f"/api/skills/{slug}").status_code == 204
    assert client.get("/api/skills").json() == []


def test_skills_install_collection(client, tmp_path):
    root = tmp_path / "collection"
    for name in ("alpha", "beta"):
        d = root / "skills" / name
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text(f"# {name}\nDoes {name} things.\n")

    resp = client.post("/api/skills/install", json={"source": str(root), "subpath": "skills"})
    assert resp.status_code == 201, resp.text
    assert sorted(s["name"] for s in resp.json()) == ["alpha", "beta"]
    assert sorted(s["slug"] for s in client.get("/api/skills").json()) == ["alpha", "beta"]


def test_skills_invalid_source(client):
    assert client.post("/api/skills/install", json={"source": "definitely not a source"}).status_code == 400
    assert client.post("/api/skills/install", json={"source": ""}).status_code == 400


def test_skill_source_parsing():
    from home import skills

    assert skills.parse_source("owner/repo") == ("git", "https://github.com/owner/repo", None)
    assert skills.parse_source("owner/repo#skills/pdf") == (
        "git",
        "https://github.com/owner/repo",
        "skills/pdf",
    )
    assert skills.parse_source("npm:left-pad") == ("npm", "left-pad", None)
    assert skills.parse_source("https://example.com/x.tar.gz")[0] == "archive"
    assert skills.parse_source("https://github.com/o/r")[0] == "git"
    with pytest.raises(skills.InvalidSource):
        skills.parse_source("not a source")


def test_skill_safe_extract_rejects_traversal(tmp_path):
    import io
    import zipfile

    from home import skills

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr("../evil.txt", "x")
    with pytest.raises(skills.InvalidSource):
        skills._safe_extract(buf.getvalue(), tmp_path / "out")


def test_skill_extract_tarball(tmp_path):
    import io
    import tarfile

    from home import skills

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as archive:
        data = b"# hello\n"
        info = tarfile.TarInfo("SKILL.md")
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))
    skills._safe_extract(buf.getvalue(), tmp_path / "out")
    assert (tmp_path / "out" / "SKILL.md").read_text() == "# hello\n"


def test_opencode_preset(client):
    presets = client.get("/api/providers/presets").json()
    assert "opencode" in presets
    assert presets["opencode"]["name"] == "OpenCode Go"
    assert presets["opencode"]["base_url"] == "https://opencode.ai/zen/go"


def test_provider_stored_key(client, monkeypatch):
    from home.providers import base as provider_base
    from home.registry.models import Provider

    p = client.post(
        "/api/providers",
        json={"name": "zen", "base_url": "https://opencode.ai/zen", "api_key": "sk-x"},
    ).json()
    assert p["has_key"] is True
    assert "api_key" not in p

    listed = client.get("/api/providers").json()
    assert listed[0]["has_key"] is True
    assert "api_key" not in listed[0]

    prov = Provider(name="zen", base_url="https://x", api_key="stored", api_key_env="NOPE")
    assert provider_base.resolve_api_key(prov) == "stored"
    assert provider_base.resolve_api_key("NOPE") is None


def test_provider_models_endpoint(client, monkeypatch):
    async def fake_list_models(base_url, api_key):
        assert base_url == "https://opencode.ai/zen"
        assert api_key == "sk-x"
        return ["deepseek-v4.1-flash", "gpt-5.4-mini"]

    monkeypatch.setattr("home.routers.providers.list_models", fake_list_models)
    resp = client.post(
        "/api/providers/models",
        json={"base_url": "https://opencode.ai/zen", "api_key": "sk-x"},
    )
    assert resp.status_code == 200
    assert resp.json()["models"] == ["deepseek-v4.1-flash", "gpt-5.4-mini"]
