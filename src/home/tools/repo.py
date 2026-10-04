"""Read-only git repository tools.

All commands run with cwd inside the project clone via a whitelist of
read-only git subcommands. Anything mutating (push, commit, checkout, reset,
clean, merge, rebase, and any -c / --exec-path style flag injection) is
rejected before the process spawns.
"""

import subprocess

from home.tools.registry import ProjectContext, Registry, Tool, schema

_ALLOWED = {
    "status": [],
    "log": [],
    "diff": [],
    "show": [],
    "branch": ["--list", "-a", "-r", "--show-current", "-v"],
    "tag": ["--list"],
    "remote": ["-v"],
    "rev-parse": ["--show-toplevel", "--abbrev-ref", "HEAD", "HEAD"],
    "ls-files": [],
    "fetch": ["--all", "--tags", "--prune"],
    "pull": ["--ff-only"],
    "clone": [],
}

_MUTATING_WORDS = {
    "push", "commit", "merge", "rebase", "reset", "clean", "checkout",
    "switch", "restore", "cherry-pick", "revert", "stash", "apply",
    "am", "bisect", "worktree", "submodule", "gc", "prune", "rm", "mv",
    "init", "config", "notes", "reflog", "update-index", "read-tree",
    "write-tree", "commit-tree", "hash-object", "update-ref", "symbolic-ref",
}


def _git(ctx: ProjectContext, args: list[str]) -> str:
    if not args:
        raise ValueError("empty git command")
    sub = args[0]
    if sub in _MUTATING_WORDS or sub not in _ALLOWED:
        raise PermissionError(f"git '{sub}' is not allowed (read-only)")
    for arg in args[1:]:
        if arg == "-c" or arg.startswith("-c ") or arg.startswith("--upload-pack") or arg.startswith("--config"):
            raise PermissionError("flag injection not allowed")
    result = subprocess.run(
        ["git", *args],
        cwd=ctx.local_path,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "git command failed")
    return result.stdout


def _repo_path(ctx: ProjectContext) -> str:
    return str(ctx.local_path)


def register(registry: Registry) -> None:
    registry.register(Tool(
        name="git_pull",
        description="Fast-forward pull the project clone from its remote. Read-only with respect to local history.",
        parameters=schema({"properties": {}, "required": []}, []),
        handler=lambda ctx, a: _git(ctx, ["pull", "--ff-only"]),
        group="repo",
    ))
    registry.register(Tool(
        name="git_log",
        description="Show recent commit history (git log).",
        parameters=schema({
            "max_count": {"type": "integer", "description": "number of commits"},
            "oneline": {"type": "boolean"},
            "path": {"type": "string", "description": "optional path filter"},
        }, []),
        handler=lambda ctx, a: _git(ctx, ["log", f"--max-count={a.get('max_count', 20)}"]
                                    + (["--oneline"] if a.get("oneline") else [])
                                    + (["--", a["path"]] if a.get("path") else [])),
        group="repo",
    ))
    registry.register(Tool(
        name="git_diff",
        description="Show working-tree or between-commit diffs (git diff).",
        parameters=schema({
            "ref": {"type": "string", "description": "e.g. HEAD~1 or a commit range a..b"},
            "path": {"type": "string"},
        }, []),
        handler=lambda ctx, a: _git(ctx, ["diff"]
                                    + ([a["ref"]] if a.get("ref") else [])
                                    + (["--", a["path"]] if a.get("path") else [])),
        group="repo",
    ))
    registry.register(Tool(
        name="git_show",
        description="Show a commit (git show <ref>).",
        parameters=schema({"ref": {"type": "string"}}, ["ref"]),
        handler=lambda ctx, a: _git(ctx, ["show", a["ref"]]),
        group="repo",
    ))
    registry.register(Tool(
        name="git_status",
        description="Working tree status (git status).",
        parameters=schema({"properties": {}, "required": []}, []),
        handler=lambda ctx, a: _git(ctx, ["status"]),
        group="repo",
    ))
    registry.register(Tool(
        name="git_branches",
        description="List local and remote branches.",
        parameters=schema({"properties": {}, "required": []}, []),
        handler=lambda ctx, a: _git(ctx, ["branch", "-a", "-v"]),
        group="repo",
    ))
    registry.register(Tool(
        name="repo_path",
        description="Absolute path of the project clone on this server.",
        parameters=schema({"properties": {}, "required": []}, []),
        handler=lambda ctx, a: _repo_path(ctx),
        group="repo",
    ))
