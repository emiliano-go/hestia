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
    last_opened_at: Optional[datetime] = None
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


class Milestone(SQLModel, table=True):
    """A goal that groups tasks and tracks progress.

    ``memories`` is a JSON list of ``{"id", "title"}`` snapshots linking Totem
    memories (decisions, constraints) to the milestone's outcome.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    title: str
    description: str = ""
    target_date: Optional[str] = None  # ISO date (YYYY-MM-DD), optional
    status: str = "open"  # open | done
    memories: str = "[]"  # JSON: [{"id": ..., "title": ...}]
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class Task(SQLModel, table=True):
    """A project task on the kanban board.

    Tasks are their own first-class objects, independent of chat sessions; the
    agent manages them through the task_* tools and the UI as a board.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    milestone_id: Optional[int] = Field(default=None, foreign_key="milestone.id", index=True)
    title: str
    description: str = ""
    status: str = "backlog"  # backlog | todo | doing | review | done
    priority: str = "medium"  # low | medium | high
    position: float = 0.0  # ordering within a column (float to allow inserts)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class ActionDefault(SQLModel, table=True):
    """App-wide default agent profile for one action (use-case/role).

    An action is a job the app runs an LLM for: the main chat, or a delegated
    subagent role such as exploring the repo or reviewing code. When an action
    has no agent assigned, the app falls back to the "chat" default (one agent
    for everything) and finally to a profile named like the action.
    """

    action: str = Field(primary_key=True)
    agent_id: Optional[int] = Field(default=None, foreign_key="agentconfig.id")
