"""Default tool registry for a project context."""

from home.tools import files, github, memory, repo
from home.tools.registry import Registry


def build_registry() -> Registry:
    registry = Registry()
    repo.register(registry)
    files.register(registry)
    github.register(registry)
    memory.register(registry)
    return registry
