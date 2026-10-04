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

    dist = Path(__file__).parents[3] / "web" / "dist"
    if dist.exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="web")
    return app


app = create_app()
