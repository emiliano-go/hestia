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


def session() -> Iterator[Session]:
    with Session(engine()) as s:
        yield s
