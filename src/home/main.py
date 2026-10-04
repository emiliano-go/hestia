"""FastAPI app factory: API routers + built frontend."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from home import __version__
from home.registry.db import init_db
from home.routers import chat, projects, providers, sessions


def create_app() -> FastAPI:
    app = FastAPI(title="home", version=__version__)
    init_db()

    app.include_router(projects.router)
    app.include_router(chat.router)
    app.include_router(providers.router)
    app.include_router(sessions.router)

    dist = find_web_dist()
    if dist:
        app.mount("/", StaticFiles(directory=dist, html=True), name="web")
    return app


def find_web_dist() -> Path | None:
    """Locate the built SPA: env override, repo checkout, or Docker layout."""
    import os

    candidates = [
        os.environ.get("WEB_DIST"),
        Path.cwd() / "web" / "dist",
        Path(__file__).parents[2] / "web" / "dist",  # editable/src install
        Path("/app/web/dist"),  # Docker image layout
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return Path(candidate)
    return None


app = create_app()
