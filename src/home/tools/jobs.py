"""Agent tools for background tasks.

Long work is submitted to the JobManager and runs detached. The tool returns
immediately with a task id; a completion notification arrives in the session
when it finishes, so the agent never blocks on it.
"""

from sqlmodel import Session, select

from home import jobs
from home.registry.models import BackgroundTask
from home.tools.registry import ProjectContext, Tool, schema

_ACTIVE = ("queued", "running")


def make_tools(db: Session) -> list[Tool]:
    def start_handler(ctx: ProjectContext, args: dict) -> dict:
        instruction = (args.get("instruction") or "").strip()
        if not instruction:
            raise ValueError("instruction is required")
        description = (args.get("description") or "").strip()
        if not description:
            raise ValueError("description is required (a short label)")
        job_id = jobs.submit(
            project_id=ctx.project_id,
            session_id=ctx.session_id,
            kind="agent",
            instruction=instruction,
            description=description,
            action=args.get("action") or "chat",
        )
        return {
            "job_id": job_id,
            "status": "queued",
            "note": "Running in the background; you will be notified when it finishes.",
        }

    def list_handler(ctx: ProjectContext, args: dict) -> list[dict]:
        query = select(BackgroundTask).where(BackgroundTask.project_id == ctx.project_id)
        if args.get("active_only", True):
            query = query.where(BackgroundTask.status.in_(_ACTIVE))
        rows = db.exec(query.order_by(BackgroundTask.id.desc()).limit(args.get("limit", 20))).all()
        return [jobs.as_dict(j) for j in rows]

    def output_handler(ctx: ProjectContext, args: dict) -> dict:
        job = db.get(BackgroundTask, args.get("id"))
        if job is None or job.project_id != ctx.project_id:
            raise ValueError(f"unknown job id: {args.get('id')}")
        data = jobs.as_dict(job)
        data["result"] = (job.result or "")[:4000]
        return data

    def stop_handler(ctx: ProjectContext, args: dict) -> dict:
        job = db.get(BackgroundTask, args.get("id"))
        if job is None or job.project_id != ctx.project_id:
            raise ValueError(f"unknown job id: {args.get('id')}")
        return jobs.stop(job.id) or jobs.as_dict(job)

    return [
        Tool(
            name="start_background_task",
            description=(
                "Start a long agent task in the background. Returns a task id "
                "immediately; the agent is notified when it finishes, so keep "
                "working or stop instead of waiting. Use for research, long "
                "reviews, or anything that should not block the conversation."
            ),
            parameters=schema(
                {
                    "instruction": {
                        "type": "string",
                        "description": "complete, self-contained task for the background agent",
                    },
                    "description": {
                        "type": "string",
                        "description": "short 3 to 5 word label shown in the UI",
                    },
                    "action": {
                        "type": "string",
                        "description": "optional action/role key (default chat)",
                    },
                },
                ["instruction", "description"],
            ),
            handler=start_handler,
            group="background",
        ),
        Tool(
            name="job_list",
            description="List background tasks for this project (active by default).",
            parameters=schema(
                {
                    "active_only": {"type": "boolean"},
                    "limit": {"type": "integer"},
                },
                [],
            ),
            handler=list_handler,
            group="background",
        ),
        Tool(
            name="job_output",
            description="Get the status and result snapshot of a background task (non-blocking).",
            parameters=schema({"id": {"type": "integer"}}, ["id"]),
            handler=output_handler,
            group="background",
        ),
        Tool(
            name="job_stop",
            description="Stop a queued or running background task.",
            parameters=schema({"id": {"type": "integer"}}, ["id"]),
            handler=stop_handler,
            group="background",
        ),
    ]
