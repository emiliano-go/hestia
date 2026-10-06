"""Agent profiles: presets, delegation mode, and validation."""

from tests.api.conftest import _mk_provider


def test_agent_presets_expose_modes(client):
    presets = client.get("/api/agents/presets").json()
    assert presets["explore"]["mode"] == "read"
    assert presets["github-scan"]["mode"] == "read"
    assert presets["code-reviewer"]["mode"] == "read"
    assert presets["writer"]["mode"] == "write"
    assert presets["memory-keeper"]["mode"] == "write"
    assert presets["bulk-editor"]["mode"] == "write"
    assert "writes" in presets["bulk-editor"]["tools"]


def test_agent_mode_roundtrip_and_validation(client):
    provider = _mk_provider(client)
    created = client.post(
        "/api/agents",
        json={
            "name": "writer",
            "provider_id": provider["id"],
            "tools": ["workspace", "repo"],
            "mode": "write",
        },
    ).json()
    assert created["mode"] == "write"

    updated = client.put(f"/api/agents/{created['id']}", json={"mode": "read"}).json()
    assert updated["mode"] == "read"

    listed = client.get("/api/agents").json()
    assert listed[0]["mode"] == "read"

    resp = client.post(
        "/api/agents",
        json={"name": "bad", "provider_id": provider["id"], "mode": "admin"},
    )
    assert resp.status_code == 400
