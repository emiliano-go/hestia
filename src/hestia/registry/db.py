"""Registry database access (SQLModel + sqlite at $DATA_DIR/hestia.db)."""

from typing import Iterator

from sqlmodel import SQLModel, Session, create_engine

from hestia import config

_engine = None


def engine():
    global _engine
    if _engine is None:
        data_dir = config.data_dir()
        data_dir.mkdir(parents=True, exist_ok=True)
        new_db = data_dir / "hestia.db"
        legacy_db = data_dir / "home.db"
        if legacy_db.exists() and not new_db.exists():
            legacy_db.rename(new_db)  # one-time rename from the old app name
        _engine = create_engine(
            f"sqlite:///{new_db}",
            echo=False,
            connect_args={"check_same_thread": False},  # background job workers
        )
    return _engine


def init_db() -> None:
    SQLModel.metadata.create_all(engine())
    _migrate()


def _migrate() -> None:
    """Add columns missing from pre-existing SQLite tables (create_all never alters)."""
    with engine().begin() as conn:
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(project)")}
        if columns and "last_opened_at" not in columns:
            conn.exec_driver_sql("ALTER TABLE project ADD COLUMN last_opened_at DATETIME")
        if columns and "allow_git_writes" not in columns:
            conn.exec_driver_sql(
                "ALTER TABLE project ADD COLUMN allow_git_writes BOOLEAN DEFAULT 0"
            )
        if columns and "token_budget" not in columns:
            conn.exec_driver_sql("ALTER TABLE project ADD COLUMN token_budget INTEGER")
        if columns and "budget_enforced" not in columns:
            conn.exec_driver_sql(
                "ALTER TABLE project ADD COLUMN budget_enforced BOOLEAN DEFAULT 0"
            )
        if columns and "require_write_approval" not in columns:
            conn.exec_driver_sql(
                "ALTER TABLE project ADD COLUMN require_write_approval BOOLEAN DEFAULT 0"
            )
        if columns and "allow_local_browser" not in columns:
            conn.exec_driver_sql(
                "ALTER TABLE project ADD COLUMN allow_local_browser BOOLEAN DEFAULT 0"
            )

        task_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(task)")}
        if task_columns and "milestone_id" not in task_columns:
            conn.exec_driver_sql("ALTER TABLE task ADD COLUMN milestone_id INTEGER")
        if task_columns and "depends_on" not in task_columns:
            conn.exec_driver_sql("ALTER TABLE task ADD COLUMN depends_on TEXT DEFAULT '[]'")
        if task_columns and "acceptance" not in task_columns:
            conn.exec_driver_sql("ALTER TABLE task ADD COLUMN acceptance TEXT DEFAULT ''")
        if task_columns and "github_issue" not in task_columns:
            conn.exec_driver_sql("ALTER TABLE task ADD COLUMN github_issue INTEGER")
        if task_columns and "source" not in task_columns:
            conn.exec_driver_sql("ALTER TABLE task ADD COLUMN source TEXT DEFAULT 'user'")
        if task_columns and "due_at" not in task_columns:
            conn.exec_driver_sql("ALTER TABLE task ADD COLUMN due_at DATETIME")
        if task_columns and "pr_url" not in task_columns:
            conn.exec_driver_sql("ALTER TABLE task ADD COLUMN pr_url TEXT")

        question_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(question)")}
        if question_columns and "kind" not in question_columns:
            conn.exec_driver_sql("ALTER TABLE question ADD COLUMN kind TEXT DEFAULT 'question'")
        if question_columns and "meta" not in question_columns:
            conn.exec_driver_sql("ALTER TABLE question ADD COLUMN meta TEXT DEFAULT '{}'")

        session_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(session)")}
        if session_columns and "action" not in session_columns:
            conn.exec_driver_sql("ALTER TABLE session ADD COLUMN action TEXT DEFAULT 'chat'")

        provider_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(provider)")}
        if provider_columns and "api_key" not in provider_columns:
            conn.exec_driver_sql("ALTER TABLE provider ADD COLUMN api_key TEXT")
        if provider_columns and "models" not in provider_columns:
            conn.exec_driver_sql("ALTER TABLE provider ADD COLUMN models TEXT DEFAULT '[]'")
            # seed the list from the existing single default model
            conn.exec_driver_sql(
                "UPDATE provider SET models = '[\"' || model || '\"]' "
                "WHERE (models IS NULL OR models = '[]') AND model IS NOT NULL AND model != ''"
            )

        agent_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(agentconfig)")}
        if agent_columns and "model" not in agent_columns:
            conn.exec_driver_sql("ALTER TABLE agentconfig ADD COLUMN model TEXT")
        if agent_columns and "mode" not in agent_columns:
            conn.exec_driver_sql("ALTER TABLE agentconfig ADD COLUMN mode TEXT DEFAULT 'read'")
            # profiles that can already write workspace/memory become write mode
            conn.exec_driver_sql(
                "UPDATE agentconfig SET mode = 'write' "
                "WHERE tools LIKE '%workspace%' OR tools LIKE '%memory%'"
            )

        message_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(message)")}
        if message_columns and "tool_call_id" not in message_columns:
            conn.exec_driver_sql("ALTER TABLE message ADD COLUMN tool_call_id TEXT")
        if message_columns and "ok" not in message_columns:
            conn.exec_driver_sql("ALTER TABLE message ADD COLUMN ok BOOLEAN")

        schedule_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(schedule)")}
        if schedule_columns and "trigger" not in schedule_columns:
            conn.exec_driver_sql("ALTER TABLE schedule ADD COLUMN trigger TEXT DEFAULT 'interval'")
        if schedule_columns and "event" not in schedule_columns:
            conn.exec_driver_sql("ALTER TABLE schedule ADD COLUMN event TEXT DEFAULT ''")
        if schedule_columns and "event_filter" not in schedule_columns:
            conn.exec_driver_sql("ALTER TABLE schedule ADD COLUMN event_filter TEXT DEFAULT ''")
        if schedule_columns and "cooldown_minutes" not in schedule_columns:
            conn.exec_driver_sql("ALTER TABLE schedule ADD COLUMN cooldown_minutes INTEGER DEFAULT 0")
        if schedule_columns and "last_event_key" not in schedule_columns:
            conn.exec_driver_sql("ALTER TABLE schedule ADD COLUMN last_event_key TEXT DEFAULT ''")


def session() -> Iterator[Session]:
    with Session(engine()) as s:
        yield s
