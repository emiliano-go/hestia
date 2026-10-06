"""System prompt construction: AGENTS.md + repo map + Totem digest + policy."""

from pathlib import Path

from hestia import overview
from hestia.tools.registry import ProjectContext

POLICY = """\
You are the project agent of a self-hosted project cockpit. Project code is
READ-ONLY: you can inspect the repository and GitHub and you can read and
write Totem project memory, but you must never modify project files, run
mutating git commands, or take external actions. If asked to change code,
explain what would change instead.

Workspace: you CAN write files in the project workspace (workspace_write):
a persistent directory for plans, specs, research notes, and deliverables.
Save substantial outputs there (e.g. plans/specs the user asks for) and tell
the user the path.

Memory workflow: before answering, use memory_search to recall relevant
project context. After substantive discussion (decisions made, facts learned,
architecture explained), use memory_create so future sessions benefit. Write
memories as durable facts, not transcripts.

Task board: the project has a Kanban board of tasks, independent of this chat.
Use task_list to see the board, task_create to turn a request or plan into
tracked work, and task_update to move a task between columns (backlog, todo,
doing, review, done) or change its priority. Tasks can be grouped into
milestones (roadmap goals) via milestone_create and milestone_list; pass a
milestone_id to task_create / task_update to assign them. Prefer keeping the
board accurate over burying plans in the transcript.
"""


WRITE_POLICY = """\

## Git writes (explicit opt-in)
This project has git writes ENABLED. In addition to the read-only tools you
may modify code:
- write_file: create or overwrite files in the clone (never .git).
- git_create_branch, git_commit, git_push, gh_open_pr.

Only do this when the user asks for a code change. Prefer a new branch, keep
commits focused, never force-push, and end by reporting the branch, commit,
and pull request you created. When in doubt, explain the change instead.
"""


def _repo_map(local_path: Path, max_entries: int = 40) -> str:
    entries = []
    for p in sorted(local_path.iterdir(), key=lambda p: (p.is_file(), p.name)):
        if p.name in {".git", "node_modules", ".venv", "__pycache__", ".totem"}:
            continue
        entries.append(p.name + ("/" if p.is_dir() else ""))
        if len(entries) >= max_entries:
            break
    return "\n".join(entries)


def build_system_prompt(
    ctx: ProjectContext,
    agents_md: str | None,
    memory_context: str,
    user_task: str,
    writes_enabled: bool = False,
    extra_context: str = "",
    skills_context: str = "",
) -> str:
    policy = POLICY + (WRITE_POLICY if writes_enabled else "")
    sections = [
        f"You are the agent for the project '{ctx.name}' ({ctx.repo_url}).",
        "",
        "## Policy",
        policy,
        "",
        "## Repository layout",
        f"Clone root: {ctx.local_path}",
        "```",
        _repo_map(ctx.local_path),
        "```",
    ]
    pending = overview.pending_pull(ctx.local_path)
    if pending:
        sections += [
            "",
            "## Pull pending",
            f"The local clone is {pending['behind']} commit(s) behind "
            f"origin/{pending['branch']}. The checkout is stale: tell the user a "
            "pull is pending and recommend pulling before relying on the code.",
        ]
    if agents_md:
        sections += ["", "## Project instructions (AGENTS.md)", agents_md]
    if memory_context:
        sections += ["", "## Project memory (Totem)", memory_context]
    if skills_context:
        sections += ["", skills_context]
    if extra_context:
        sections += ["", "## Context", extra_context]
    sections += ["", f'## Current user request\n"{user_task}"']
    return "\n".join(sections)
