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

        task_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(task)")}
        if task_columns and "milestone_id" not in task_columns:
            conn.exec_driver_sql("ALTER TABLE task ADD COLUMN milestone_id INTEGER")


def session() -> Iterator[Session]:
    with Session(engine()) as s:
        yield s
