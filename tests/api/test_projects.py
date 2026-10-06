"""Project lifecycle: clone, delete cascade, streaming create, pull."""

from pathlib import Path

from hestia import config
from hestia import totem_store

from tests.api.conftest import _mk_project


def test_clone_auth_args(client, monkeypatch):
    from hestia.routers import projects

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

    from hestia.registry.db import engine
    from hestia.registry.models import (
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
    from hestia.registry.models import Session as ChatSession

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


def test_create_project_stream(client):
    import json
    import subprocess
    import tempfile

    src = tempfile.mkdtemp()
    subprocess.run(["git", "init", "-q"], cwd=src, check=True)
    (Path(src) / "README.md").write_text("# demo\n")
    subprocess.run(["git", "add", "."], cwd=src, check=True)
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-qm", "i"],
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


def test_pull_pending_and_inbox(client):
    import subprocess
    from pathlib import Path

    from sqlmodel import Session

    from hestia import inbox, overview
    from hestia.registry.db import engine

    project = _mk_project(client, name="pulltest")
    clone = Path(project["local_path"])
    src = Path(project["repo_url"])

    # up to date: nothing pending, ahead/behind both zero
    assert overview.pending_pull(clone, do_fetch=True) is None

    # a new upstream commit makes the clone behind by one
    (src / "new.txt").write_text("x")
    subprocess.run(["git", "add", "."], cwd=src, check=True)
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-qm", "more"],
        cwd=src,
        check=True,
    )

    pending = overview.pending_pull(clone, do_fetch=True)
    assert pending and pending["behind"] == 1

    # ahead/behind must not be swapped
    summary = overview.git_summary(clone)
    assert summary["behind"] == 1
    assert summary["ahead"] == 0

    # polling surfaces a "Pull pending" inbox item
    with Session(engine()) as db:
        inbox.check_pulls(db)
    items = client.get("/api/inbox").json()["items"]
    pulls = [i for i in items if i["kind"] == "pull"]
    assert pulls and pulls[0]["title"] == "Pull pending"
    assert "behind origin/" in pulls[0]["subtitle"]

    # pulling clears the item
    assert client.post(f"/api/projects/{project['id']}/pull").status_code == 200
    items = client.get("/api/inbox").json()["items"]
    assert not [i for i in items if i["kind"] == "pull"]


def test_project_preference_memory_always_in_context(client):
    from hestia import totem_store

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


def test_allow_local_browser_roundtrip(client):
    project = _mk_project(client)
    assert project["allow_local_browser"] is False

    updated = client.put(
        f"/api/projects/{project['id']}", json={"allow_local_browser": True}
    ).json()
    assert updated["allow_local_browser"] is True

    fetched = client.get(f"/api/projects/{project['id']}").json()
    assert fetched["allow_local_browser"] is True
