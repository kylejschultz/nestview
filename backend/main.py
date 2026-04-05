import os
from contextlib import asynccontextmanager
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

_version_file = Path("/app/VERSION")
APP_VERSION = _version_file.read_text().strip() if _version_file.exists() else "dev"

from database import create_db_and_tables, engine
from api import containers, logs, events, settings, actions
from api.auth import api_key_required
from services.cleanup import run_cleanup
from services.app_settings import get_setting, set_setting


def _seed_settings_from_env():
    """On first start, persist env-var bootstrap values into AppSetting rows
    so they are immediately visible and editable in the Settings UI.
    Values are only written if the key does not yet exist in the DB.
    """
    seeds = {
        "log_retention_days": os.getenv("LOG_RETENTION_DAYS", "7"),
        "exited_container_ttl_hours": os.getenv("EXITED_CONTAINER_TTL_HOURS", "0.083"),
        "timezone": os.getenv("TZ", "UTC"),
    }
    with Session(engine) as session:
        for key, value in seeds.items():
            if value and get_setting(session, key) is None:
                set_setting(session, key, value)
        session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    _seed_settings_from_env()

    scheduler = AsyncIOScheduler()
    scheduler.add_job(run_cleanup, "interval", hours=1, id="cleanup")
    scheduler.start()

    yield

    scheduler.shutdown()


app = FastAPI(title="Nestview", version=APP_VERSION, lifespan=lifespan)

# The backend is not port-exposed in docker-compose — only nginx (frontend service)
# reaches it.  CORS is permissive here so local `npm run dev` works without extra
# config.  If you expose the backend port directly, restrict allow_origins to the
# specific host(s) that need access.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PATCH", "PUT"],
    allow_headers=["*"],
)

app.include_router(containers.router)
app.include_router(logs.router)
app.include_router(events.router)
app.include_router(settings.router)
app.include_router(actions.router)


@app.get("/api/version")
def version():
    return {"version": APP_VERSION}


@app.get("/api/health")
def health():
    return {"status": "ok", "version": APP_VERSION}


@app.get("/api/config")
def config():
    """
    Returns public configuration the frontend needs before auth is established.
    Never exposes secret values — only boolean flags derived from them.
    """
    return {"api_key_required": api_key_required()}
