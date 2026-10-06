"""Subagent spawning: the main agent can delegate to named agent profiles.

Each AgentConfig has its own provider (any OpenAI-compatible model), system
prompt, and tool subset, so cheap models can run exploration while the main
agent reasons with a stronger one.

Delegation has two modes, enforced here for foreground and background runs:
read (exploration, scanning, review: no writes at all) and write (workspace
files, project memory, and file edits in the clone when the project has git
writes enabled, for cheap bulk work like doc sweeps, renames, and typo
fixes). Subagents can never run mutating git commands (branch/commit/push/PR)
or use principal-only capabilities (images, task board, automations,
notifications, delegation itself); the principal commits and opens PRs after
review. Subagents never get the agents group, so they cannot spawn further
subagents.
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor

from sqlmodel import Session, select

from hestia import actions, runs
from hestia.agent import loop as agent_loop
from hestia.agent.prompt import POLICY
from hestia.providers.base import OpenAIClient, resolve_api_key
from hestia.registry.models import AgentConfig, Provider
from hestia.tools import build_registry
from hestia.tools.registry import ProjectContext, Registry, Tool, schema

DELEGABLE_GROUPS = (
    "repo",
    "files",
    "github",
    "web",
    "skills",
    "memory",
    "workspace",
    "writes",
)

SUBAGENT_PROMPT = """\
You are a subagent of a project cockpit agent. Complete the task below and
return a concise, self-contained summary of your findings (plain text, no
questions back).

## Policy
""" + POLICY

READONLY_NOTE = """\
## Read-only mode (overrides the policy above)
This run has read-only tools: you cannot write files, the workspace, or
memory. Investigate, inspect, and report only.
"""

WRITE_NOTE = """\
## Write mode
You may write workspace files and project memory. When git writes are enabled
you may also edit repository files with write_file. You cannot run mutating
git commands: the principal agent handles branches, commits, pushes, and pull
requests after reviewing your changes.
"""


def delegated_registry(
    groups: str, mode: str = "read", writes: bool = False, db=None
) -> Registry:
    """The only registry a subagent ever gets: delegable groups, read-only in read mode.

    Principal-only groups (images, tasks, agents, automations, ...) and
    principal-only tools (git branch/commit/push/PR) are stripped even when a
    profile lists them. ``writes`` is the project's allow_git_writes flag: in
    write mode it adds file editing in the clone; git mutations stay with the
    principal.
    """
    wanted = [g.strip() for g in (groups or "").split(",") if g.strip()]
    allowed = [g for g in wanted if g in DELEGABLE_GROUPS]
    registry = build_registry()
    if writes:
        from hestia.tools import gitwrites

        gitwrites.register(registry, db)
    registry = registry.filtered(allowed).delegable()
    return registry.readonly() if (mode or "read") == "read" else registry


def subagent_system(config: AgentConfig) -> str:
    note = READONLY_NOTE if (config.mode or "read") == "read" else WRITE_NOTE
    return f"{SUBAGENT_PROMPT}\n{note}\n## Agent instructions\n{config.system_prompt}"


def make_tools(db: Session) -> list[Tool]:
    def run_handler(ctx: ProjectContext, args: dict) -> dict:
        config = None
        if args.get("action"):
            config = actions.resolve_action(db, args["action"])
        if config is None and args.get("agent"):
            config = db.exec(select(AgentConfig).where(AgentConfig.name == args["agent"])).first()
        if config is None:
            raise ValueError(
                f"unknown agent profile or action: {args.get('action') or args.get('agent')}"
            )
        if args.get("run_in_background"):
            from hestia import jobs

            key = args.get("action") or args.get("agent") or config.name
            job_id = jobs.submit(
                project_id=ctx.project_id,
                session_id=ctx.session_id,
                kind="subagent",
                instruction=args["task"],
                description=args.get("description") or args["task"][:60],
                action=key,
            )
            return {
                "job_id": job_id,
                "status": "queued",
                "note": "Subagent running in the background; you will be notified when it finishes.",
            }
        provider = db.get(Provider, config.provider_id)
        if provider is None:
            raise ValueError(f"agent profile '{config.name}' has no valid provider")
        provider = actions.effective_provider(config, provider)
        client = OpenAIClient(
            provider.base_url,
            resolve_api_key(provider),
            provider.model,
            session=f"subagent-{ctx.session_id or ctx.project_id}",
        )
        registry = delegated_registry(
            config.tools, config.mode, writes=ctx.allow_git_writes, db=db
        )
        if not registry.all():
            raise ValueError(
                f"agent profile '{config.name}' has no delegable tools "
                f"(tools={config.tools!r}, mode={config.mode!r})"
            )
        messages = [
            {"role": "system", "content": subagent_system(config)},
            {"role": "user", "content": args["task"]},
        ]
        child = runs.manager.create(
            "subagent",
            project_id=ctx.project_id,
            session_id=ctx.session_id,
            parent_run_id=ctx.run_id,
            title=args["task"],
        )
        result = _run_subagent_in_thread(ctx, client, registry, messages, child)
        if "error" in result:
            raise RuntimeError(result["error"])
        return result

    def list_handler(ctx: ProjectContext, args: dict) -> list[dict]:
        configs = db.exec(select(AgentConfig)).all()
        return [
            {
                "name": c.name,
                "tools": c.tools,
                "mode": c.mode,
                "max_turns": c.max_turns,
                "provider_id": c.provider_id,
            }
            for c in configs
        ]

    return [
        Tool(
            name="run_subagent",
            description=(
                "Delegate a subtask to a specialised agent: read mode for "
                "exploration, scanning, and review, write mode for workspace "
                "deliverables, memory curation, and bulk file edits in the "
                "clone (doc sweeps, renames, typo fixes) with a cheap model. "
                "Pass an 'action' (the configured role: explore, github-scan, "
                "memory-keeper, writer, code-reviewer, bulk-edit) so the app "
                "uses the agent assigned to it, or a specific 'agent' profile "
                "name (see agent_list). Subagents can edit files but never "
                "branch, commit, push, or open PRs; those are yours."
            ),
            parameters=schema({
                "action": {
                    "type": "string",
                    "description": "configured action/role for the subtask (preferred)",
                    "enum": [
                        "explore",
                        "github-scan",
                        "memory-keeper",
                        "writer",
                        "code-reviewer",
                        "bulk-edit",
                    ],
                },
                "agent": {"type": "string", "description": "agent profile name (see agent_list)"},
                "task": {"type": "string", "description": "self-contained task for the subagent"},
                "run_in_background": {
                    "type": "boolean",
                    "description": (
                        "run the subagent detached and return a job id now; you "
                        "will be notified when it finishes"
                    ),
                },
                "description": {
                    "type": "string",
                    "description": "short 3 to 5 word label (required with run_in_background)",
                },
            }, ["task"]),
            handler=run_handler,
            group="agents",
        ),
        Tool(
            name="agent_list",
            description="List available subagent profiles (name, mode, tool groups, provider).",
            parameters=schema({}, []),
            handler=list_handler,
            group="agents",
        ),
    ]


def _progress(parent_run, tool_call_id: str | None, text: str) -> None:
    """Forward a child run's step into the parent tool row."""
    if not parent_run or not tool_call_id:
        return
    runs.manager.emit(
        parent_run,
        {"type": "tool_progress", "tool_call_id": tool_call_id, "text": text[:160]},
    )


async def _run_subagent(ctx, client, registry, messages, run=None) -> dict:
    final = ""
    status, error = "done", ""
    parent = runs.manager.get(ctx.run_id) if ctx.run_id else None
    steps = 0
    try:
        async for event in agent_loop.run_turn(ctx, client, registry, messages, run=run):
            if run is not None:
                runs.manager.emit(run, event)
            etype = event["type"]
            if etype == "tool_call":
                steps += 1
                _progress(parent, ctx.tool_call_id, f"step {steps} · {event.get('name')}")
            elif etype == "thinking" and event.get("text"):
                _progress(parent, ctx.tool_call_id, event["text"].strip().splitlines()[-1][:120])
            elif etype == "message":
                final = event.get("content", "") or final
            elif etype in ("error", "stopped", "timed_out"):
                status, error = etype, event.get("message", "")
    finally:
        if run is not None:
            runs.manager.finish(run, status, result=final, error=error)
    if error:
        return {"error": error}
    return {"summary": final}


def _run_subagent_in_thread(ctx, client, registry, messages, run=None) -> dict:
    """Run the subagent loop off the main event loop.

    Tool handlers are sync, so this is called from inside the parent's running
    loop; asyncio.run needs its own thread. Subagent tools never touch the
    request DB session, so crossing threads here is safe.
    """
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(
            asyncio.run, _run_subagent(ctx, client, registry, messages, run)
        ).result()
