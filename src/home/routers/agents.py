"""Agent profiles: named main/sub agents with their own provider and tools."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from home.registry.db import session
from home.registry.models import AgentConfig

router = APIRouter(prefix="/api/agents", tags=["agents"])

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
        tools=tools,
        max_turns=body.get("max_turns", 6),
    )
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
