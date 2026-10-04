"""Registry models: projects, sessions, messages, providers.

Sessions and messages are views for the UI; durable cross-session memory
lives in each project's Totem DB, not here.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    repo_url: str
    local_path: str
    agents_md: Optional[str] = None
    default_provider_id: Optional[int] = None
    created_at: datetime = Field(default_factory=_now)


class Session(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    title: str = "New session"
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class Message(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", index=True)
    role: str
    content: str
    tool_calls: Optional[str] = None  # JSON: OpenAI tool-call list
    name: Optional[str] = None  # tool name for role=tool
    created_at: datetime = Field(default_factory=_now)


class Provider(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    base_url: str
    api_key_env: str  # name of the env var holding the key, never the key itself
    model: str
    created_at: datetime = Field(default_factory=_now)


class AgentConfig(SQLModel, table=True):
    """A named agent profile: its own model, prompt, and tool subset.

    Used for the main agent selection and for subagents spawned via the
    run_subagent tool (e.g. a cheap explore agent).
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    system_prompt: str = ""
    provider_id: int = Field(foreign_key="provider.id")
    tools: str = "repo,files"  # comma-separated tool groups: repo, files, github, memory
    max_turns: int = 6
    created_at: datetime = Field(default_factory=_now)
