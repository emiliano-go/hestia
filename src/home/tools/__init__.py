"""Default tool registry for a project context."""

from home.tools import files, github, memory, repo, workspace
from home.tools.registry import Registry


def build_registry() -> Registry:
    registry = Registry()
    repo.register(registry)
    files.register(registry)
    github.register(registry)
    memory.register(registry)
    workspace.register(registry)
    return registry
