"""Inbox: GitHub polling into a notification table (PRs, issues, CI failures).

The first poll for a project is a silent baseline (existing items arrive
already read) so enabling the poller does not flood the inbox.
"""

from __future__ import annotations

from sqlmodel import Session, select

from home import events, notify, overview
from home.registry.models import InboxItem, Project

_KINDS = ("pr", "issue", "run")

_EVENT_KIND = {"run": "ci_failure", "pr": "pr_opened", "issue": "issue_opened"}


def _has_items(db: Session, project_id: int) -> bool:
    return (
        db.exec(select(InboxItem).where(InboxItem.project_id == project_id)).first()
        is not None
    )


def _add(
    db: Session,
    project_id: int,
    kind: str,
    external_id: str,
    title: str,
    subtitle: str,
    url: str | None,
    baseline: bool,
) -> InboxItem | None:
    exists = db.exec(
        select(InboxItem).where(
            InboxItem.project_id == project_id,
            InboxItem.kind == kind,
            InboxItem.external_id == external_id,
        )
    ).first()
    if exists:
        return None
    item = InboxItem(
        project_id=project_id,
        kind=kind,
        external_id=external_id,
        title=title,
        subtitle=subtitle,
        url=url,
        read=baseline,
    )
    db.add(item)
    return item


def _notify_new_items(project: Project, items: list[InboxItem]) -> None:
    if not notify.configured():
        return
    lines = "\n".join(f"- {i.title} ({i.subtitle})" for i in items[:5])
    if len(items) > 5:
        lines += f"\n- ...and {len(items) - 5} more"
    notify.send(
        f"{len(items)} new in {project.name}",
        lines,
        tags=["inbox_tray"],
        url=items[0].url,
    )


def poll_project(db: Session, project: Project) -> tuple[int, list[InboxItem]]:
    """Fetch open PRs/issues and failing runs; insert unseen ones.

    Returns (created count, newly added unread items).
    """
    if not overview.repo_slug(project.repo_url):
        return 0, []
    prs = overview.github_list(project, "prs", state="open", limit=30)
    if not prs.get("available"):
        return 0, []
    issues = overview.github_list(project, "issues", state="open", limit=30)
    runs = overview.github_list(project, "runs", limit=15)

    baseline = not _has_items(db, project.id)
    created = 0
    new_unread: list[InboxItem] = []

    def track(item: InboxItem | None) -> None:
        nonlocal created
        if item is None:
            return
        created += 1
        if not item.read:
            new_unread.append(item)
            events.emit(
                db,
                project.id,
                _EVENT_KIND.get(item.kind, item.kind),
                {"title": item.title, "url": item.url, "text": item.subtitle},
                key=item.external_id,
            )

    for pr in prs.get("items", []):
        track(
            _add(
                db,
                project.id,
                "pr",
                f"pr:{pr['number']}",
                f"#{pr['number']} {pr['title']}",
                f"Pull request · {pr.get('user') or 'unknown'}",
                pr.get("url"),
                baseline,
            )
        )
    for issue in issues.get("items", []):
        track(
            _add(
                db,
                project.id,
                "issue",
                f"issue:{issue['number']}",
                f"#{issue['number']} {issue['title']}",
                f"Issue · {issue.get('user') or 'unknown'}",
                issue.get("url"),
                baseline,
            )
        )
    for run in runs.get("items", []):
        if run.get("conclusion") != "failure":
            continue
        track(
            _add(
                db,
                project.id,
                "run",
                f"run:{run.get('id')}",
                run.get("name") or "CI run",
                "CI failure",
                run.get("url"),
                baseline,
            )
        )
    if created:
        db.commit()
    return created, new_unread


def poll_all(db: Session) -> int:
    total = 0
    for project in db.exec(select(Project)).all():
        try:
            created, new_unread = poll_project(db, project)
        except Exception:
            continue  # one unreachable repo must not stop the rest
        total += created
        if new_unread:
            _notify_new_items(project, new_unread)
    return total


def list_items(db: Session, unread_only: bool = False) -> dict:
    query = select(InboxItem).order_by(InboxItem.created_at.desc(), InboxItem.id.desc())
    if unread_only:
        query = query.where(InboxItem.read == False)  # noqa: E712
    items = db.exec(query.limit(100)).all()
    names = {p.id: p.name for p in db.exec(select(Project)).all()}
    unread = len(
        db.exec(select(InboxItem).where(InboxItem.read == False)).all()  # noqa: E712
    )
    return {
        "unread": unread,
        "items": [
            {
                "id": i.id,
                "project_id": i.project_id,
                "project": names.get(i.project_id, ""),
                "kind": i.kind,
                "external_id": i.external_id,
                "title": i.title,
                "subtitle": i.subtitle,
                "url": i.url,
                "read": i.read,
                "created_at": overview._iso(i.created_at),
            }
            for i in items
        ],
    }
