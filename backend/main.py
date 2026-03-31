import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.database import create_db_and_tables
from backend.api import containers, logs, events
from backend.services.cleanup import run_cleanup

COLLECTOR_KEY = os.getenv("NESTVIEW_COLLECTOR_KEY", "")


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()

    scheduler = AsyncIOScheduler()
    scheduler.add_job(run_cleanup, "interval", hours=1, id="cleanup")
    scheduler.start()

    yield

    scheduler.shutdown()


app = FastAPI(title="Nestview", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(containers.router)
app.include_router(logs.router)
app.include_router(events.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "0.1.0"}
