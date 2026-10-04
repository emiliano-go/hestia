"""Agent tools for the project kanban board.

These are bound to the registry DB (like the subagent tools), so the main chat
agent can list, create, move, edit, and delete tasks. Tasks are independent of
sessions, so the board outlives any conversation.
"""

from sqlmodel import Session, select

from home import milestones as milestones_mod
from home import taskboard
from home.registry.models import Milestone, Task
from home.tools.registry import ProjectContext, Tool, schema


def make_tools(db: Session) -> list[Tool]:
    def list_handler(ctx: ProjectContext, args: dict) -> list[dict]:
        query = select(Task).where(Task.project_id == ctx.project_id)
        if args.get("status"):
            query = query.where(Task.status == args["status"])
        tasks = db.exec(query.order_by(Task.position, Task.id)).all()
        return [
            {
                "id": t.id,
                "title": t.title,
                "status": t.status,
                "priority": t.priority,
                "description": t.description,
                "milestone_id": t.milestone_id,
            }
            for t in tasks
        ]

    def create_handler(ctx: ProjectContext, args: dict) -> dict:
        task = taskboard.create(
            db,
            ctx.project_id,
            title=args.get("title", ""),
            description=args.get("description", ""),
            status=args.get("status", "backlog"),
            priority=args.get("priority", "medium"),
            milestone_id=args.get("milestone_id"),
        )
        return taskboard.as_dict(task)

    def update_handler(ctx: ProjectContext, args: dict) -> dict:
        task = db.get(Task, args.get("id"))
        if task is None or task.project_id != ctx.project_id:
            raise ValueError(f"unknown task id: {args.get('id')}")
        return taskboard.as_dict(taskboard.update(db, task, args))

    def delete_handler(ctx: ProjectContext, args: dict) -> dict:
        task = db.get(Task, args.get("id"))
        if task is None or task.project_id != ctx.project_id:
            raise ValueError(f"unknown task id: {args.get('id')}")
        db.delete(task)
        db.commit()
        return {"deleted": args.get("id")}

    def milestone_list_handler(ctx: ProjectContext, args: dict) -> list[dict]:
        items = db.exec(select(Milestone).where(Milestone.project_id == ctx.project_id)).all()
        return [milestones_mod.as_dict(m, milestones_mod.progress(db, m)) for m in items]

    def milestone_create_handler(ctx: ProjectContext, args: dict) -> dict:
        milestone = milestones_mod.create(
            db,
            ctx.project_id,
            title=args.get("title", ""),
            description=args.get("description", ""),
            target_date=args.get("target_date"),
        )
        return milestones_mod.as_dict(milestone)

    def milestone_update_handler(ctx: ProjectContext, args: dict) -> dict:
        milestone = db.get(Milestone, args.get("id"))
        if milestone is None or milestone.project_id != ctx.project_id:
            raise ValueError(f"unknown milestone id: {args.get('id')}")
        return milestones_mod.as_dict(milestones_mod.update(db, milestone, args))

    return [
        Tool(
            name="task_list",
            description="List the project's kanban tasks, optionally filtered by status.",
            parameters=schema(
                {"status": {"type": "string", "enum": taskboard.STATUSES}}, []
            ),
            handler=list_handler,
            group="tasks",
        ),
        Tool(
            name="task_create",
            description=(
                "Create a task on the project kanban board. Use this to turn a plan "
                "or request into tracked work. Status defaults to 'backlog'."
            ),
            parameters=schema(
                {
                    "title": {"type": "string", "description": "short task title"},
                    "description": {"type": "string", "description": "optional detail"},
                    "status": {"type": "string", "enum": taskboard.STATUSES},
                    "priority": {"type": "string", "enum": taskboard.PRIORITIES},
                    "milestone_id": {
                        "type": "integer",
                        "description": "optional milestone to group this task under",
                    },
                },
                ["title"],
            ),
            handler=create_handler,
            group="tasks",
        ),
        Tool(
            name="task_update",
            description=(
                "Update a task by id: rename, edit, change priority, or move it between "
                "columns (status: backlog, todo, doing, review, done)."
            ),
            parameters=schema(
                {
                    "id": {"type": "integer", "description": "task id (see task_list)"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "status": {"type": "string", "enum": taskboard.STATUSES},
                    "priority": {"type": "string", "enum": taskboard.PRIORITIES},
                    "milestone_id": {"type": "integer", "description": "milestone id, or 0 to clear"},
                },
                ["id"],
            ),
            handler=update_handler,
            group="tasks",
        ),
        Tool(
            name="task_delete",
            description="Delete a task from the board by id.",
            parameters=schema({"id": {"type": "integer"}}, ["id"]),
            handler=delete_handler,
            group="tasks",
        ),
        Tool(
            name="milestone_list",
            description="List the project's milestones (roadmap goals) with task progress.",
            parameters=schema({"properties": {}, "required": []}, []),
            handler=milestone_list_handler,
            group="tasks",
        ),
        Tool(
            name="milestone_create",
            description=(
                "Create a milestone (roadmap goal) that groups tasks and tracks progress. "
                "Optionally give a target date (YYYY-MM-DD)."
            ),
            parameters=schema(
                {
                    "title": {"type": "string", "description": "short goal title"},
                    "description": {"type": "string", "description": "optional detail"},
                    "target_date": {"type": "string", "description": "target date YYYY-MM-DD"},
                },
                ["title"],
            ),
            handler=milestone_create_handler,
            group="tasks",
        ),
        Tool(
            name="milestone_update",
            description=(
                "Update a milestone by id: rename, edit, set a target date, or mark it "
                "open/done (status)."
            ),
            parameters=schema(
                {
                    "id": {"type": "integer"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "target_date": {"type": "string"},
                    "status": {"type": "string", "enum": milestones_mod.STATUSES},
                },
                ["id"],
            ),
            handler=milestone_update_handler,
            group="tasks",
        ),
    ]
