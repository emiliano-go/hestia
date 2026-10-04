"""System prompt construction: AGENTS.md + repo map + Totem digest + policy."""

from pathlib import Path

from home.tools.registry import ProjectContext

POLICY = """\
You are the project agent of a self-hosted project cockpit. You are READ-ONLY:
you can inspect the repository and GitHub and you can read and write Totem
project memory, but you must never modify project files, run mutating git
commands, or take external actions. If asked to change code, explain what
would change instead.

Memory workflow: before answering, use memory_search to recall relevant
project context. After substantive discussion (decisions made, facts learned,
architecture explained), use memory_create so future sessions benefit. Write
memories as durable facts, not transcripts.
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
) -> str:
    sections = [
        f"You are the agent for the project '{ctx.name}' ({ctx.repo_url}).",
        "",
        "## Policy",
        POLICY,
        "",
        "## Repository layout",
        f"Clone root: {ctx.local_path}",
        "```",
        _repo_map(ctx.local_path),
        "```",
    ]
    if agents_md:
        sections += ["", "## Project instructions (AGENTS.md)", agents_md]
    if memory_context:
        sections += ["", "## Project memory (Totem)", memory_context]
    sections += ["", f'## Current user request\n"{user_task}"']
    return "\n".join(sections)
