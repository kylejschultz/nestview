from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import create_db_and_tables
from api import containers, logs, events, settings, actions
from services.cleanup import run_cleanup


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()

    scheduler = AsyncIOScheduler()
    scheduler.add_job(run_cleanup, "interval", hours=1, id="cleanup")
    scheduler.start()

    yield

    scheduler.shutdown()


app = FastAPI(title="Nestview", version="0.1.0", lifespan=lifespan)

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


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "0.1.0"}
