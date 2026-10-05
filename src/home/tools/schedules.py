"""Agent tools for recurring automations (scheduled agent runs).

Lets the agent schedule itself: "check this every Friday" becomes a Schedule
that the background worker runs on its interval.
"""

from sqlmodel import Session, select

from home import actions, scheduler
from home.registry.models import Schedule
from home.tools.registry import ProjectContext, Tool, schema

MIN_INTERVAL = 1


def _validate_action(action: str) -> str:
    action = (action or "chat").strip()
    if action not in actions.ACTIONS_BY_KEY:
        raise ValueError(f"unknown action: {action}")
    return action


def _validate_interval(value) -> int:
    try:
        return max(MIN_INTERVAL, int(value))
    except (TypeError, ValueError):
        raise ValueError("interval_minutes must be a number")


def make_tools(db: Session) -> list[Tool]:
    def create_handler(ctx: ProjectContext, args: dict) -> dict:
        instruction = (args.get("instruction") or "").strip()
        if not instruction:
            raise ValueError("instruction is required")
        schedule = Schedule(
            project_id=ctx.project_id,
            action=_validate_action(args.get("action", "chat")),
            instruction=instruction,
            interval_minutes=_validate_interval(args.get("interval_minutes", 1440)),
            enabled=True,
        )
        db.add(schedule)
        db.commit()
        db.refresh(schedule)
        return scheduler.as_dict(schedule)

    def list_handler(ctx: ProjectContext, args: dict) -> list[dict]:
        rows = db.exec(
            select(Schedule).where(Schedule.project_id == ctx.project_id).order_by(Schedule.id)
        ).all()
        return [scheduler.as_dict(r) for r in rows]

    def cancel_handler(ctx: ProjectContext, args: dict) -> dict:
        schedule = db.get(Schedule, args.get("id"))
        if schedule is None or schedule.project_id != ctx.project_id:
            raise ValueError(f"unknown schedule id: {args.get('id')}")
        db.delete(schedule)
        db.commit()
        return {"deleted": args.get("id")}

    return [
        Tool(
            name="schedule_create",
            description=(
                "Create a recurring automation that runs an agent job on an "
                "interval (for example every 1440 minutes, daily). Use when the "
                "owner asks to check or do something regularly."
            ),
            parameters=schema(
                {
                    "instruction": {
                        "type": "string",
                        "description": "what the agent should do each run; {date} is substituted",
                    },
                    "action": {
                        "type": "string",
                        "description": "action/role key (default chat)",
                    },
                    "interval_minutes": {
                        "type": "integer",
                        "description": "how often to run, in minutes (default 1440)",
                    },
                },
                ["instruction"],
            ),
            handler=create_handler,
            group="automations",
        ),
        Tool(
            name="schedule_list",
            description="List this project's recurring automations.",
            parameters=schema({}, []),
            handler=list_handler,
            group="automations",
        ),
        Tool(
            name="schedule_cancel",
            description="Delete a recurring automation by id.",
            parameters=schema({"id": {"type": "integer"}}, ["id"]),
            handler=cancel_handler,
            group="automations",
        ),
    ]
