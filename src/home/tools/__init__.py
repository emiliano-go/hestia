"""Default tool registry for a project context.

``writes=True`` adds the opt-in mutating git tools; only pass it when the
project has ``allow_git_writes`` set.
"""

from home.tools import files, github, memory, notify, repo, webfetch, workspace
from home.tools import gitwrites
from home.tools.registry import Registry


def build_registry(writes: bool = False, db=None) -> Registry:
    registry = Registry()
    repo.register(registry)
    files.register(registry)
    github.register(registry)
    memory.register(registry)
    workspace.register(registry)
    notify.register(registry)
    webfetch.register(registry)
    if writes:
        gitwrites.register(registry, db)
    return registry
