import os
from datetime import datetime, timezone

import docker
from fastapi import APIRouter

from build_info import APP_VERSION, BUILD_SHA, APP_START_TIME
from database import DB_PATH as _DB_PATH

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("")
def get_system_info() -> dict:
    uptime_seconds = int((datetime.now(timezone.utc) - APP_START_TIME).total_seconds())

    try:
        db_size_bytes: int | None = _DB_PATH.stat().st_size
    except FileNotFoundError:
        db_size_bytes = None

    try:
        docker_connected = docker.from_env().ping()
    except Exception:
        docker_connected = False

    return {
        "version": APP_VERSION,
        "build_channel": os.environ.get("BUILD_CHANNEL", ""),
        "build_sha": BUILD_SHA,
        "uptime_seconds": uptime_seconds,
        "db_size_bytes": db_size_bytes,
        "docker_connected": docker_connected,
    }
