"""Background worker: due scheduled agent runs and inbox polling.

Runs inside the FastAPI lifespan. Schedules are serial (one agent run at a
time); a long run simply delays the next tick, which is fine for a
single-user cockpit.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from home import actions, inbox, notify, overview, reminders, settings, taskboard, totem_store, usage, watchers
from home.agent.prompt import build_system_prompt
from home.agent.run import run_once
from home.registry.db import engine
from home.registry.models import InboxItem, Project, Provider, Schedule, Task
from home.tools.registry import ProjectContext

TICK_SECONDS = max(5, int(os.environ.get("HOME_SCHEDULER_TICK", "30")))
INBOX_POLL_SECONDS = max(60, int(os.environ.get("HOME_INBOX_POLL_SECONDS", "600")))

logger = logging.getLogger("home.scheduler")

SCHEDULE_NOTE = """\

## Scheduled run
This is an unattended scheduled run. Do the job above and stop: write any
deliverable to the project workspace, keep it concise, and end with a short
plain-text report of what you did (it is shown on the Automations page).
"""


BRIEFING_PROMPT = """\
Write the commentary for today's briefing from the digest below.
Be concrete and brief (3 to 5 sentences): the single most important thing,
then the next two or three actions. No greeting, no filler.

## Digest
{digest}
"""


def _fmt_due(value: datetime) -> str:
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return aware.strftime("%b %d %H:%M UTC")


def _briefing_digest(db: Session) -> str:
    lines: list[str] = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    soon = reminders.due(db, now + timedelta(days=1))
    if soon:
        items = "; ".join(f"{r.text} ({_fmt_due(r.due_at)})" for r in soon[:5])
        lines.append(f"Reminders: {items}")

    for project in db.exec(select(Project)).all():
        tasks = db.exec(select(Task).where(Task.project_id == project.id)).all()
        blocked = taskboard.blocked_map(db, project.id)
        ready = [
            t
            for t in tasks
            if t.status in ("todo", "doing", "review") and t.id not in blocked
        ]
        if ready:
            titles = ", ".join(f"#{t.id} {t.title}" for t in ready[:3])
            lines.append(f"{project.name} next up: {titles}")
        risky = taskboard.at_risk(db, project.id)
        if risky:
            items = "; ".join(
                f"#{t.id} {t.title} (due {t.due_at.date().isoformat()})"
                for t in risky[:4]
            )
            lines.append(f"{project.name} at risk: {items}")
        budget = usage.budget_state(db, project)
        if budget["budget"] and budget["percent"] is not None and budget["percent"] >= 80:
            lines.append(f"{project.name} token budget at {budget['percent']}%")

    unread = db.exec(select(InboxItem).where(InboxItem.read == False)).all()  # noqa: E712
    if unread:
        titles = ", ".join(i.title for i in unread[:3])
        lines.append(f"Inbox: {len(unread)} unread ({titles})")
    return "\n".join(lines)


def _first_provider_project(db: Session) -> Project | None:
    agent = actions.resolve_action(db, "chat")
    for project in db.exec(select(Project)).all():
        provider_id = (agent.provider_id if agent else None) or project.default_provider_id
        if provider_id and db.get(Provider, provider_id):
            return project
    return None


async def _maybe_send_briefing(db: Session) -> None:
    if not settings.get_bool(db, "briefing_enabled"):
        return
    local = settings.local_now(db)
    target = settings.get(db, "briefing_time") or "08:00"
    try:
        hh, mm = (int(part) for part in target.split(":"))
    except ValueError:
        hh, mm = 8, 0
    if (local.hour, local.minute) < (hh, mm):
        return
    today = local.date().isoformat()
    if settings.get(db, "briefing_last_sent") == today:
        return

    message = _briefing_digest(db) or "Nothing needs your attention today."
    if settings.get_bool(db, "briefing_agent"):
        project = _first_provider_project(db)
        if project is not None:
            agent = actions.resolve_action(db, "chat")
            provider_id = (agent.provider_id if agent else None) or project.default_provider_id
            provider = db.get(Provider, provider_id) if provider_id else None
            if provider is not None:
                digest = totem_store.digest(
                    project.local_path, task="Write the briefing commentary"
                )
                system = build_system_prompt(
                    ProjectContext.from_project(project),
                    agents_md=project.agents_md,
                    memory_context=digest.get("context", ""),
                    user_task="Write the briefing commentary",
                    extra_context=settings.prompt_context(db),
                )
                if agent and agent.system_prompt:
                    system += f"\n\n## Agent instructions\n{agent.system_prompt}"
                system += "\n\n" + BRIEFING_PROMPT.format(digest=message)
                report, error, tokens = await run_once(
                    project,
                    provider,
                    system,
                    "Write the briefing commentary.",
                    groups="workspace,repo,files",
                    max_turns=4,
                    tasks_db=db,
                )
                usage.record(
                    db, project.id, action="briefing", model=provider.model, usage=tokens
                )
                if report and not error:
                    message = f"{report.strip()}\n\n{message}"

    notify.send(
        "Morning briefing",
        message[:1800],
        tags=["sunrise"],
        url=settings.notification_url("/home"),
    )
    settings.set_many(db, {"briefing_last_sent": today})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _naive(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=None) if value.tzinfo else value


def as_dict(schedule: Schedule) -> dict:
    return {
        "id": schedule.id,
        "project_id": schedule.project_id,
        "action": schedule.action,
        "instruction": schedule.instruction,
        "interval_minutes": schedule.interval_minutes,
        "enabled": schedule.enabled,
        "last_run_at": overview._iso(schedule.last_run_at),
        "last_status": schedule.last_status,
        "last_report": schedule.last_report,
        "created_at": overview._iso(schedule.created_at),
    }


def due_schedules(db: Session, now: datetime | None = None) -> list[Schedule]:
    now = _naive(now or _now())
    due = []
    for schedule in db.exec(select(Schedule).where(Schedule.enabled == True)).all():  # noqa: E712
        last = _naive(schedule.last_run_at) or _naive(schedule.created_at) or now
        if now - last >= timedelta(minutes=max(1, schedule.interval_minutes)):
            due.append(schedule)
    return due


async def run_schedule(schedule_id: int) -> dict | None:
    """Run one schedule now and record the outcome. Returns its state or None."""
    with Session(engine()) as db:
        schedule = db.get(Schedule, schedule_id)
        if not schedule:
            return None
        project = db.get(Project, schedule.project_id)
        if not project:
            db.delete(schedule)
            db.commit()
            return None

        agent = actions.resolve_action(db, schedule.action)
        provider_id = (
            (agent.provider_id if agent else None) or project.default_provider_id
        )
        provider = db.get(Provider, provider_id) if provider_id else None

        budget = usage.budget_state(db, project)
        if project.budget_enforced and budget["over"]:
            schedule.last_run_at = _now()
            schedule.last_status = "skipped: budget"
            schedule.last_report = (
                f"monthly token budget reached ({budget['used']}/{budget['budget']})"
            )
            db.add(schedule)
            db.commit()
            db.refresh(schedule)
            await asyncio.to_thread(
                notify.send,
                f"Schedule skipped: {schedule.action}",
                f"{project.name}: {schedule.last_report}",
                "high",
                ["warning"],
                settings.notification_url(f"/p/{project.id}/automations"),
            )
            return as_dict(schedule)

        if not provider:
            schedule.last_run_at = _now()
            schedule.last_status = "error"
            schedule.last_report = "no provider configured for this project"
        else:
            instruction = schedule.instruction.replace(
                "{date}", _now().date().isoformat()
            )
            digest = totem_store.digest(project.local_path, task=instruction)
            system = build_system_prompt(
                ProjectContext.from_project(project),
                agents_md=project.agents_md,
                memory_context=digest.get("context", ""),
                user_task=instruction,
                extra_context=settings.prompt_context(db),
            )
            if agent and agent.system_prompt:
                system += f"\n\n## Agent instructions\n{agent.system_prompt}"
            system += SCHEDULE_NOTE
            groups = actions.ACTIONS_BY_KEY.get(schedule.action, {}).get("tools", "")
            report, error, tokens = await run_once(
                project,
                provider,
                system,
                instruction or "Run the scheduled job.",
                groups=groups,
                max_turns=agent.max_turns if agent else 8,
                tasks_db=db,
            )
            usage.record(
                db, project.id, action=schedule.action, model=provider.model, usage=tokens
            )
            schedule.last_status = "error" if error else "ok"
            schedule.last_report = (error or report or "").strip()[:4000]
            schedule.last_run_at = _now()

        db.add(schedule)
        db.commit()
        db.refresh(schedule)
        status = schedule.last_status or "ok"
        await asyncio.to_thread(
            notify.send,
            f"Schedule {status}: {schedule.action}",
            f"{project.name}: {(schedule.last_report or '(no report)')[:300]}",
            "high" if status == "error" else "default",
            ["warning"] if status == "error" else ["white_check_mark"],
            settings.notification_url(f"/p/{project.id}/automations"),
        )
        return as_dict(schedule)


def _poll_inbox() -> None:
    """In its own thread and session, so notify.send never blocks the loop."""
    with Session(engine()) as db:
        inbox.poll_all(db)


async def worker() -> None:
    """Tick forever: reminders, briefing, watches, schedules, then inbox."""
    inbox_clock = INBOX_POLL_SECONDS
    while True:
        try:
            with Session(engine()) as db:
                reminders.fire_due(db)
                await _maybe_send_briefing(db)
                await watchers.check_due(db)

            with Session(engine()) as db:
                due_ids = [s.id for s in due_schedules(db)]
            for schedule_id in due_ids:
                await run_schedule(schedule_id)

            inbox_clock += TICK_SECONDS
            if inbox_clock >= INBOX_POLL_SECONDS:
                inbox_clock = 0
                await asyncio.to_thread(_poll_inbox)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("scheduler tick failed")
        await asyncio.sleep(TICK_SECONDS)
