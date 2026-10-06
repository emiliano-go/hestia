"""Agent profiles: named main/sub agents with their own provider and tools."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from hestia.actions import ACTIONS, ACTIONS_BY_KEY, action_defaults
from hestia.registry.db import session
from hestia.registry.models import ActionDefault, AgentConfig

router = APIRouter(prefix="/api/agents", tags=["agents"])
actions_router = APIRouter(prefix="/api/actions", tags=["actions"])

PRESETS = {
    "explore": {
        "name": "explore",
        "system_prompt": (
            "You are an exploration subagent. Investigate the repository "
            "structure, files, and git history relevant to the task. Return "
            "file paths, symbols, and concise findings."
        ),
        "tools": "repo,files",
        "max_turns": 6,
    },
    "github-scan": {
        "name": "github-scan",
        "system_prompt": (
            "You are a GitHub scanning subagent. Inspect commits, PRs, "
            "issues, and CI runs relevant to the task. Return titles, "
            "numbers, and statuses."
        ),
        "tools": "github,repo",
        "max_turns": 6,
    },
    "memory-keeper": {
        "name": "memory-keeper",
        "system_prompt": (
            "You are a memory curation subagent. Search and review project "
            "memory: find gaps, stale entries, and missing decisions worth "
            "recording. Create or update memories where warranted."
        ),
        "tools": "memory",
        "max_turns": 6,
    },
    "writer": {
        "name": "writer",
        "system_prompt": (
            "You are a writing subagent. Produce the deliverable in the "
            "project workspace with workspace_write (plans, specs, docs) and "
            "return a short summary with the file paths you wrote."
        ),
        "tools": "workspace,repo,files",
        "max_turns": 8,
    },
    "code-reviewer": {
        "name": "code-reviewer",
        "system_prompt": (
            "You are a read-only code review subagent. Read the relevant "
            "code and diffs, then return findings ordered by severity."
        ),
        "tools": "repo,files,github",
        "max_turns": 8,
    },
}


@router.get("/presets")
def list_presets():
    return PRESETS


@router.get("")
def list_agents(s: Session = Depends(session)):
    return s.exec(select(AgentConfig)).all()


@router.post("", status_code=201)
def create_agent(body: dict, s: Session = Depends(session)):
    for field in ("name", "provider_id"):
        if not body.get(field):
            raise HTTPException(400, f"{field} is required")
    if s.exec(select(AgentConfig).where(AgentConfig.name == body["name"])).first():
        raise HTTPException(409, f"agent profile already exists: {body['name']}")
    tools = body.get("tools", "repo,files")
    if isinstance(tools, list):
        tools = ",".join(tools)
    config = AgentConfig(
        name=body["name"],
        system_prompt=body.get("system_prompt", ""),
        provider_id=body["provider_id"],
        model=(body.get("model") or "").strip() or None,
        tools=tools,
        max_turns=body.get("max_turns", 6),
    )
    s.add(config)
    s.commit()
    s.refresh(config)
    return config


@router.put("/{agent_id}")
def update_agent(agent_id: int, body: dict, s: Session = Depends(session)):
    config = s.get(AgentConfig, agent_id)
    if not config:
        raise HTTPException(404, "agent profile not found")
    if body.get("name"):
        config.name = body["name"]
    if "system_prompt" in body:
        config.system_prompt = body["system_prompt"] or ""
    if body.get("provider_id"):
        config.provider_id = body["provider_id"]
    if "model" in body:
        config.model = (body.get("model") or "").strip() or None
    if "tools" in body:
        tools = body["tools"]
        config.tools = ",".join(tools) if isinstance(tools, list) else tools
    if body.get("max_turns"):
        config.max_turns = int(body["max_turns"])
    s.add(config)
    s.commit()
    s.refresh(config)
    return config


@router.delete("/{agent_id}", status_code=204)
def delete_agent(agent_id: int, s: Session = Depends(session)):
    config = s.get(AgentConfig, agent_id)
    if not config:
        raise HTTPException(404, "agent profile not found")
    s.delete(config)
    s.commit()


@actions_router.get("")
def list_actions(s: Session = Depends(session)):
    defaults = action_defaults(s)
    return [{**a, "agent_id": defaults.get(a["key"])} for a in ACTIONS]


@actions_router.put("/{key}")
def set_action(key: str, body: dict, s: Session = Depends(session)):
    if key not in ACTIONS_BY_KEY:
        raise HTTPException(404, "unknown action")
    agent_id = body.get("agent_id")
    if agent_id is not None and not s.get(AgentConfig, agent_id):
        raise HTTPException(400, "agent profile not found")
    row = s.get(ActionDefault, key)
    if row is None:
        row = ActionDefault(action=key, agent_id=agent_id)
    else:
        row.agent_id = agent_id
    s.add(row)
    s.commit()
    return {"action": key, "agent_id": agent_id}
