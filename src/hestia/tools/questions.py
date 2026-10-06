"""Agent tool: ask the owner a question and end the turn.

The question is persisted on the chat session; the owner's next message is the
answer. A notification is pushed when a channel is configured.
"""

from hestia import notify, settings
from hestia import questions as questions_mod
from hestia.agent.loop import AgentPause
from hestia.tools.registry import ProjectContext, Tool, schema


def make_tools(db) -> list[Tool]:
    def ask_handler(ctx: ProjectContext, args: dict) -> dict:
        if not ctx.session_id:
            raise ValueError("ask_user only works inside an interactive chat session")
        question = (args.get("question") or "").strip()
        if not question:
            raise ValueError("question is required")
        options = [str(o).strip() for o in (args.get("options") or []) if str(o).strip()][:6]
        row = questions_mod.create(db, ctx.session_id, ctx.project_id, question, options)
        notify.send(
            f"Agent question in {ctx.name}",
            question,
            priority="high",
            tags=["question"],
            url=settings.notification_url(
                f"/p/{ctx.project_id}/chat?session={ctx.session_id}"
            ),
        )
        raise AgentPause(
            {"id": row.id, "question": question, "options": options, "kind": "question"}
        )

    def approve_handler(ctx: ProjectContext, args: dict) -> dict:
        if not ctx.session_id:
            raise ValueError("ask_approval only works inside an interactive chat session")
        action = (args.get("action") or "").strip()
        summary = (args.get("summary") or "").strip()
        if not action or not summary:
            raise ValueError("action and summary are required")
        row = questions_mod.create(
            db,
            ctx.session_id,
            ctx.project_id,
            summary,
            options=["approve", "deny"],
            kind="approval",
            meta={"action": action},
        )
        notify.send(
            f"Approval needed: {action}",
            summary,
            priority="high",
            tags=["lock"],
            url=settings.notification_url(
                f"/p/{ctx.project_id}/chat?session={ctx.session_id}"
            ),
        )
        raise AgentPause(
            {
                "id": row.id,
                "question": summary,
                "options": ["approve", "deny"],
                "kind": "approval",
            }
        )

    return [
        Tool(
            name="ask_user",
            description=(
                "Ask the owner a question when you need a decision or missing information "
                "that blocks the work. The turn ends and the question is shown in the chat; "
                "the owner's next message is the answer. Offer up to 6 short options when "
                "the choice is enumerable. Do not use it for rhetorical or optional "
                "questions; make reasonable assumptions when the answer is low-stakes."
            ),
            parameters=schema(
                {
                    "question": {"type": "string", "description": "the question, one or two sentences"},
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "optional suggested answers (max 6)",
                    },
                },
                ["question"],
            ),
            handler=ask_handler,
            group="chat",
        ),
        Tool(
            name="ask_approval",
            description=(
                "Ask the owner to approve a sensitive action (for example git_push or "
                "gh_open_pr). The turn ends; the owner answers approve or deny with their "
                "next message. Required before pushing or opening PRs when the project "
                "enables write approval."
            ),
            parameters=schema(
                {
                    "action": {
                        "type": "string",
                        "description": "action key, e.g. git_push or gh_open_pr",
                    },
                    "summary": {
                        "type": "string",
                        "description": "what you want to do and why, one or two sentences",
                    },
                },
                ["action", "summary"],
            ),
            handler=approve_handler,
            group="chat",
        ),
    ]
