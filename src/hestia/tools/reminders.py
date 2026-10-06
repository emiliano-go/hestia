"""Agent tools for reminders."""

from sqlmodel import Session

from hestia import reminders
from hestia.tools.registry import ProjectContext, Tool, schema


def make_tools(db: Session) -> list[Tool]:
    def remind_handler(ctx: ProjectContext, args: dict) -> dict:
        reminder = reminders.create(
            db,
            text=args.get("text", ""),
            due_at=args.get("due_at"),
            recurrence=args.get("recurrence", "none"),
            project_id=args.get("project_id") or ctx.project_id,
        )
        return reminders.as_dict(reminder)

    def list_handler(ctx: ProjectContext, args: dict) -> list[dict]:
        return [
            reminders.as_dict(r)
            for r in reminders.list_all(db, include_done=bool(args.get("include_done")))
        ]

    def cancel_handler(ctx: ProjectContext, args: dict) -> dict:
        from hestia.registry.models import Reminder

        reminder = db.get(Reminder, args.get("id"))
        if reminder is None:
            raise ValueError(f"unknown reminder id: {args.get('id')}")
        reminders.delete(db, reminder)
        return {"deleted": args.get("id")}

    return [
        Tool(
            name="remind_me",
            description=(
                "Create a reminder that fires a notification at due_at. Use the Current "
                "time from your context to resolve phrases like 'tomorrow at 9'. due_at "
                "must be ISO 8601 with an offset, e.g. 2026-10-05T09:00:00+02:00. "
                "Recurrence is none, daily, or weekly."
            ),
            parameters=schema(
                {
                    "text": {"type": "string", "description": "what to remind about"},
                    "due_at": {"type": "string", "description": "ISO 8601 due time"},
                    "recurrence": {"type": "string", "enum": reminders.RECURRENCES},
                },
                ["text", "due_at"],
            ),
            handler=remind_handler,
            group="chat",
        ),
        Tool(
            name="reminder_list",
            description="List pending reminders, soonest first.",
            parameters=schema(
                {"include_done": {"type": "boolean", "description": "also show completed ones"}},
                [],
            ),
            handler=list_handler,
            group="chat",
        ),
        Tool(
            name="reminder_cancel",
            description="Cancel and delete a reminder by id.",
            parameters=schema({"id": {"type": "integer"}}, ["id"]),
            handler=cancel_handler,
            group="chat",
        ),
    ]
