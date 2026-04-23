import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import Depends, FastAPI
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlmodel import Session

logger = logging.getLogger(__name__)

_version_file = Path("/app/VERSION")
_raw_version = _version_file.read_text().strip() if _version_file.exists() else "dev"
_build_channel = os.environ.get("BUILD_CHANNEL", "")
APP_VERSION = f"{_raw_version}-dev" if _build_channel == "dev" else _raw_version
_raw_sha = os.environ.get("BUILD_SHA", "")
BUILD_SHA: str | None = _raw_sha if _raw_sha and _raw_sha != "unknown" else None

from database import create_db_and_tables, engine
from api import containers, logs, events, settings, actions, admin, stack_actions
from api import auth as auth_router
from limiter import limiter
from services.cleanup import run_cleanup
from services.app_settings import get_setting, set_setting
from services.image_checker import run_image_check
from services.auth import require_auth


def _seed_settings_from_env():
    """On first start, persist env-var bootstrap values into AppSetting rows
    so they are immediately visible and editable in the Settings UI.
    Values are only written if the key does not yet exist in the DB.
    """
    seeds = {
        "log_retention_days": os.getenv("LOG_RETENTION_DAYS", "7"),
        "exited_container_ttl_seconds": "300",
        "timezone": os.getenv("TZ", "UTC"),
        "image_check_time": "03:00",
        "image_check_enabled": "true",
    }
    with Session(engine) as session:
        for key, value in seeds.items():
            if value and get_setting(session, key) is None:
                set_setting(session, key, value)
        session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    from migrations import run_migrations
    with Session(engine) as _migration_session:
        run_migrations(engine, _migration_session)
    _seed_settings_from_env()

    # Handle RESET_ADMIN_PASSWORD env var — clears credentials so setup wizard re-triggers
    if os.getenv("RESET_ADMIN_PASSWORD", "").strip().lower() == "true":
        with Session(engine) as _reset_session:
            from sqlmodel import select as _select
            from models import AppSetting as _AppSetting
            for _key in ("admin_username", "admin_password_hash"):
                _row = _reset_session.exec(_select(_AppSetting).where(_AppSetting.key == _key)).first()
                if _row:
                    _reset_session.delete(_row)
            _reset_session.commit()
        logger.warning(
            "auth: RESET_ADMIN_PASSWORD=true — credentials cleared. "
            "Remove this env var after completing setup."
        )

    # Ensure session_secret exists (creates one if not present)
    with Session(engine) as _secret_session:
        from services.auth import _load_or_create_secret
        _load_or_create_secret(_secret_session)

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

    from services.collector import start_collector

    poll_interval = max(1, int(os.getenv("POLL_INTERVAL", "10")))
    log_batch_interval = max(1, int(os.getenv("LOG_BATCH_INTERVAL", "5")))
    start_collector(poll_interval=poll_interval, log_batch_interval=log_batch_interval)

    from fastapi.staticfiles import StaticFiles

    static_dir = Path("/app/static")
    if static_dir.exists():
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
        logger.info("Serving frontend static files from %s", static_dir)
    else:
        logger.info("No static dir found at %s — frontend not served (dev mode)", static_dir)

    if os.getenv("RESET_ADMIN_PASSWORD", "").strip().lower() == "true":
        logger.warning(
            "auth: RESET_ADMIN_PASSWORD is still set in your environment. "
            "Remove it after completing setup to prevent credentials being cleared on next restart."
        )

    yield

    scheduler.shutdown()


app = FastAPI(title="Nestview", version=APP_VERSION, lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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

app.include_router(auth_router.router)
app.include_router(containers.router,    dependencies=[Depends(require_auth)])
app.include_router(logs.router,          dependencies=[Depends(require_auth)])
app.include_router(events.router,        dependencies=[Depends(require_auth)])
app.include_router(settings.router,      dependencies=[Depends(require_auth)])
app.include_router(actions.router,       dependencies=[Depends(require_auth)])
app.include_router(admin.router,         dependencies=[Depends(require_auth)])
app.include_router(stack_actions.router, dependencies=[Depends(require_auth)])


@app.get("/api/version")
def version():
    return {"version": APP_VERSION, "build_sha": BUILD_SHA}


@app.get("/api/health")
def health():
    return {"status": "ok", "version": APP_VERSION}


@app.get("/api/config")
def config():
    return {"api_key_required": False}


@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    static_dir = Path("/app/static").resolve()
    requested = (static_dir / full_path).resolve()
    if requested.is_file() and requested.is_relative_to(static_dir):
        return FileResponse(requested)
    index = static_dir / "index.html"
    if index.exists():
        return FileResponse(index)
    return {"error": "Frontend not found"}
