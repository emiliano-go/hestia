"""Tool registry: MCP-style tools shared by the built-in agent and the MCP server.

Every tool takes a ProjectContext plus a JSON-args dict and returns a
JSON-serializable result. All tools are read-only with respect to project code.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional


@dataclass
class ProjectContext:
    project_id: int
    name: str
    repo_url: str
    local_path: Path
    workspace_path: Path | None = None
    session_id: int | None = None  # set for interactive chat turns

    @classmethod
    def from_project(cls, project) -> "ProjectContext":
        from hestia import config

        return cls(
            project_id=project.id,
            name=project.name,
            repo_url=project.repo_url,
            local_path=Path(project.local_path),
            workspace_path=config.workspace_dir(project.name),
        )


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema for the tool arguments
    handler: Callable[[ProjectContext, dict[str, Any]], Any]
    group: str = ""  # repo | files | github | memory | agents


class Registry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> Optional[Tool]:
        return self._tools.get(name)

    def all(self) -> list[Tool]:
        return list(self._tools.values())

    def filtered(self, groups: list[str]) -> "Registry":
        """A view restricted to the given tool groups (plus groupless tools)."""
        view = Registry()
        for tool in self._tools.values():
            if not tool.group or tool.group in groups:
                view.register(tool)
        return view

    def openai_schemas(self, tools: list["Tool"] | None = None) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": {
                        "type": "object",
                        "properties": t.parameters.get("properties", {}),
                        "required": t.parameters.get("required", []),
                    },
                },
            }
            for t in (tools if tools is not None else self.all())
        ]


def schema(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": required}
