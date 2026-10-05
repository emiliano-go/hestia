"""Registry database access (SQLModel + sqlite at $DATA_DIR/home.db)."""

from pathlib import Path
from typing import Iterator

from sqlmodel import SQLModel, Session, create_engine

from home import config

_engine = None


def engine():
    global _engine
    if _engine is None:
        config.data_dir().mkdir(parents=True, exist_ok=True)
        _engine = create_engine(
            f"sqlite:///{Path(config.data_dir()) / 'home.db'}", echo=False
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

        question_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(question)")}
        if question_columns and "kind" not in question_columns:
            conn.exec_driver_sql("ALTER TABLE question ADD COLUMN kind TEXT DEFAULT 'question'")
        if question_columns and "meta" not in question_columns:
            conn.exec_driver_sql("ALTER TABLE question ADD COLUMN meta TEXT DEFAULT '{}'")


def session() -> Iterator[Session]:
    with Session(engine()) as s:
        yield s
