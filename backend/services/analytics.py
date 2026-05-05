import logging
import platform
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from sqlmodel import Session

from database import engine
from services.app_settings import get_setting, set_setting

logger = logging.getLogger(__name__)

_BEACON_URL = "https://beacon.kjschultz.com/ping"
_VERSION_FILE = Path("/app/VERSION")
_last_ping_date: str | None = None


def ensure_install_id(session: Session) -> None:
    """Generate and persist a stable UUID if install_id is not yet set."""
    current = get_setting(session, "install_id")
    if not current:
        set_setting(session, "install_id", str(uuid.uuid4()))
        session.commit()


def _get_arch() -> str:
    machine = platform.machine().lower()
    if "arm" in machine or "aarch" in machine:
        return "arm64"
    return "amd64"


async def run_analytics_ping() -> None:
    """Fire a daily anonymous ping when analytics is enabled. Best-effort only."""
    global _last_ping_date
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if _last_ping_date == today:
        return

    try:
        with Session(engine) as session:
            if get_setting(session, "analytics_enabled") != "true":
                return
            install_id = get_setting(session, "install_id") or ""
            if not install_id:
                return

        version = _VERSION_FILE.read_text().strip() if _VERSION_FILE.exists() else "dev"

        payload = {
            "project": "nestview",
            "install_id": install_id,
            "version": version,
            "arch": _get_arch(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(_BEACON_URL, json=payload)

        _last_ping_date = today
    except Exception:
        pass
