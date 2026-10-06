"""Default tool registry for a project context.

``writes=True`` adds the opt-in mutating git tools; only pass it when the
project has ``allow_git_writes`` set.
"""

from home.tools import files, github, memory, notify, repo, webfetch, workspace
from home.tools import gitwrites, preferences, skills
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
    skills.register(registry)
    if writes:
        gitwrites.register(registry, db)
    if db is not None:
        from home.tools import jobs as job_tools
        from home.tools import schedules as schedule_tools

        for tool in preferences.make_tools(db):
            registry.register(tool)
        for tool in job_tools.make_tools(db):
            registry.register(tool)
        for tool in schedule_tools.make_tools(db):
            registry.register(tool)
    return registry
