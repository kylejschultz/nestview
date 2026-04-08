import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlmodel import Session

logger = logging.getLogger(__name__)

_version_file = Path("/app/VERSION")
APP_VERSION = _version_file.read_text().strip() if _version_file.exists() else "dev"

from database import create_db_and_tables, engine
from api import containers, logs, events, settings, actions, admin, stack_actions
from services.cleanup import run_cleanup
from services.app_settings import get_setting, set_setting
from services.image_checker import run_image_check


def _seed_settings_from_env():
    """On first start, persist env-var bootstrap values into AppSetting rows
    so they are immediately visible and editable in the Settings UI.
    Values are only written if the key does not yet exist in the DB.
    """
    seeds = {
        "log_retention_days": os.getenv("LOG_RETENTION_DAYS", "7"),
        "exited_container_ttl_hours": os.getenv("EXITED_CONTAINER_TTL_HOURS", "0.083"),
        "timezone": os.getenv("TZ", "UTC"),
        "image_check_time": "03:00",
        "image_check_enabled": "true",
    }
    with Session(engine) as session:
        for key, value in seeds.items():
            if value and get_setting(session, key) is None:
                set_setting(session, key, value)
        session.commit()


_NEW_CONTAINER_COLUMNS = [
    ("image_digest",            "TEXT"),
    ("registry_digest",         "TEXT"),
    ("update_available",        "INTEGER NOT NULL DEFAULT 0"),
    ("last_digest_check",       "TEXT"),
    ("image_size",              "INTEGER"),
    ("update_alert_sent_digest","TEXT"),
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()

    with Session(engine) as _s:
        for col_name, col_type in _NEW_CONTAINER_COLUMNS:
            try:
                _s.exec(text(f"ALTER TABLE container ADD COLUMN {col_name} {col_type}"))
                _s.commit()
            except Exception:
                pass  # column already exists

    _seed_settings_from_env()

    # Read scheduler settings after seeding so the values are guaranteed in the DB.
    with Session(engine) as _s:
        raw_time = get_setting(_s, "image_check_time") or "03:00"
        check_enabled = get_setting(_s, "image_check_enabled") != "false"
    try:
        h, m = (int(x) for x in raw_time.split(":"))
    except Exception:
        h, m = 3, 0

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    scheduler = AsyncIOScheduler()
    scheduler.add_job(run_cleanup, "interval", hours=1, id="cleanup")
    if check_enabled:
        scheduler.add_job(run_image_check, "cron", hour=h, minute=m, id="image_check")
        logger.info("image_check cron registered for %02d:%02d", h, m)
    scheduler.add_job(run_image_check, "date", run_date=datetime.utcnow(), id="image_check_startup")
    logger.info("image_check startup run queued")
    scheduler.start()

    import os as _os
    from services.collector import start_collector

    poll_interval = max(1, int(_os.getenv("POLL_INTERVAL", "10")))
    log_batch_interval = max(1, int(_os.getenv("LOG_BATCH_INTERVAL", "5")))
    start_collector(poll_interval=poll_interval, log_batch_interval=log_batch_interval)

    from pathlib import Path as _Path
    from fastapi.staticfiles import StaticFiles

    static_dir = _Path("/app/static")
    if static_dir.exists():
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
        logger.info("Serving frontend static files from %s", static_dir)
    else:
        logger.info("No static dir found at %s — frontend not served (dev mode)", static_dir)

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
app.include_router(admin.router)
app.include_router(stack_actions.router)


@app.get("/api/version")
def version():
    return {"version": APP_VERSION}


@app.get("/api/health")
def health():
    return {"status": "ok", "version": APP_VERSION}


@app.get("/api/config")
def config():
    return {"api_key_required": False}
