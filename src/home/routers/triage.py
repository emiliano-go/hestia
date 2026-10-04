"""Triage: turn a GitHub issue or PR into a plan file and board tasks.

One-shot server-side agent run (like the memory fixer), not a chat session.
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from home import actions, overview, taskboard, totem_store
from home.agent import loop as agent_loop
from home.agent.prompt import build_system_prompt
from home.providers.base import OpenAIClient, resolve_api_key
from home.registry.db import session
from home.registry.models import Project, Provider
from home.tools import build_registry
from home.tools import tasks as task_tools
from home.tools.registry import ProjectContext

router = APIRouter(prefix="/api", tags=["triage"])

TRIAGE_PROMPT = """\
You are triaging a {kind} from the project's GitHub repository into actionable work.

## {kind} #{number}
Title: {title}
URL: {url}

Body:
{body}

Do this, then stop:
1. Read the repository code, history, or memory you need to understand the work.
2. Write a concise implementation plan to the project workspace with workspace_write,
   at exactly this path: {plan_path}
3. Create between 2 and 6 concrete sub-tasks on the board with task_create. Give each a
   short title and a one-line description. Group them under a milestone only if one fits.
4. End with a short plain-text report: what the item asks for, the plan path, and the
   tasks you created.
"""


@router.post("/projects/{project_id}/triage")
def triage(project_id: int, body: dict, s: Session = Depends(session)):
    project = s.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")

    kind = str(body.get("kind", "issue")).lower()
    if kind not in ("issue", "issues", "pr", "prs"):
        raise HTTPException(400, "kind must be issue or pr")
    kind = "pr" if kind.startswith("pr") else "issue"
    number = body.get("number")
    if not number:
        raise HTTPException(400, "number is required")

    try:
        item = overview.github_item(
            project, "prs" if kind == "pr" else "issues", int(number)
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # network / auth / rate limit
        raise HTTPException(502, f"could not fetch GitHub item: {str(e)[:200]}")

    plan_path = f"plans/{kind}-{number}.md"

    # Track the item immediately, even if the agent run later fails.
    parent = taskboard.create(
        s,
        project_id,
        title=f"#{number} {item['title']}",
        description=((item.get("body") or "")[:4000] + f"\n\n{item['url']}").strip(),
        status="backlog",
        priority="medium",
    )

    agent = actions.resolve_action(s, "triage")
    provider = s.get(Provider, agent.provider_id) if agent else None
    if provider is None and project.default_provider_id:
        provider = s.get(Provider, project.default_provider_id)
    if provider is None:
        raise HTTPException(400, "no provider configured for this project")

    ctx = ProjectContext.from_project(project)
    client = OpenAIClient(
        provider.base_url, resolve_api_key(provider.api_key_env), provider.model
    )
    registry = build_registry()
    for tool in task_tools.make_tools(s):
        registry.register(tool)

    digest = totem_store.digest(ctx.local_path, task=item["title"])
    system = build_system_prompt(
        ctx,
        agents_md=project.agents_md,
        memory_context=digest.get("context", ""),
        user_task=item["title"],
    )
    if agent and agent.system_prompt:
        system += f"\n\n## Agent instructions\n{agent.system_prompt}"
    system += "\n\n" + TRIAGE_PROMPT.format(
        kind=item["kind"],
        number=number,
        title=item["title"],
        url=item.get("url") or "",
        body=(item.get("body") or "(no description)")[:6000],
        plan_path=plan_path,
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Triage {item['kind']} #{number}: {item['title']}"},
    ]
    max_turns = agent.max_turns if agent else 8

    async def run():
        final = ""
        async for event in agent_loop.run_turn(
            ctx, client, registry, messages, max_turns=max_turns
        ):
            if event["type"] == "message":
                final = event.get("content", "")
            if event["type"] == "error":
                return "", event["message"]
        return final, None

    report, error = asyncio.run(run())
    return {
        "report": report,
        "error": error,
        "task_id": parent.id,
        "path": plan_path,
    }
