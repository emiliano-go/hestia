"""Round-trip tests for the Totem wrappers against a real per-project DB."""

from home import totem_store


def test_create_search_get(tmp_path):
    created = totem_store.create(
        tmp_path,
        type="decision",
        title="Use sqlite for the registry",
        statement="The registry database is plain sqlite via SQLModel.",
        tags=["architecture", "registry"],
        confidence=0.9,
    )
    assert created["id"]

    results = totem_store.search(tmp_path, "sqlite registry")
    assert any(r["id"] == created["id"] for r in results)

    got = totem_store.get(tmp_path, created["id"])
    assert got["title"] == "Use sqlite for the registry"


def test_digest_ranks_relevant_memory(tmp_path):
    totem_store.create(
        tmp_path,
        type="gotcha",
        title="Stack",
        statement="The backend is FastAPI and the frontend is React.",
        tags=["architecture"],
    )
    ctx = totem_store.digest(tmp_path, task="What stack does this project use?")
    assert ctx["context"]
    assert "FastAPI" in ctx["context"]


def test_update_and_delete(tmp_path):
    created = totem_store.create(
        tmp_path,
        type="gotcha",
        title="Temp fact",
        statement="Original statement.",
        tags=["tmp"],
    )
    updated = totem_store.update(
        tmp_path, created["id"], statement="Updated statement."
    )
    assert updated["statement"] == "Updated statement."

    deleted = totem_store.delete(tmp_path, created["id"], reason="test cleanup")
    assert deleted.get("status") in ("deleted", "deactivated")
