"""Expose the tool registry as an MCP server over stdio.

Usage: `totem-mcp`-style entrypoint; run with a project directory in
HOME_PROJECT_DIR. External agents (any MCP client) get the exact same
read-only toolset as the built-in cockpit agent, Totem memory included.
"""

import asyncio
import json
import os
from pathlib import Path

from mcp.server.lowlevel import Server

from home.tools import build_registry
from home.tools.registry import ProjectContext

_app = Server("home")


def _context() -> ProjectContext:
    path = Path(os.environ.get("HOME_PROJECT_DIR", ".")).resolve()
    return ProjectContext(project_id=0, name=path.name, repo_url="", local_path=path)


@_app.list_tools()
async def list_tools():
    registry = build_registry()
    return [
        {
            "name": t.name,
            "description": t.description,
            "inputSchema": t.parameters,
        }
        for t in registry.all()
    ]


@_app.call_tool()
async def call_tool(name: str, arguments: dict):
    registry = build_registry()
    tool = registry.get(name)
    if tool is None:
        raise ValueError(f"unknown tool: {name}")
    result = tool.handler(_context(), arguments or {})
    return [
        {
            "type": "text",
            "text": json.dumps(result, indent=2, default=str),
        }
    ]


def main() -> None:
    from mcp.server.stdio import stdio_server

    async def run():
        async with stdio_server() as (read, write):
            await _app.run(read, write, _app.create_initialization_options())

    asyncio.run(run())
