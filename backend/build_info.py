import os
from datetime import datetime, timezone
from pathlib import Path

_version_file = Path("/app/VERSION")
_raw_version = _version_file.read_text().strip() if _version_file.exists() else "dev"
APP_VERSION = _raw_version
BUILD_CHANNEL = os.environ.get("BUILD_CHANNEL", "")
BUILD_LABEL = os.environ.get("BUILD_LABEL", "")
_raw_sha = os.environ.get("BUILD_SHA", "")
BUILD_SHA: str | None = _raw_sha if _raw_sha and _raw_sha != "unknown" else None
BUILD_DISPLAY = (
    f"{BUILD_LABEL} · {BUILD_SHA}"
    if BUILD_LABEL and BUILD_SHA
    else BUILD_LABEL
    or (f"{BUILD_CHANNEL} · {BUILD_SHA}" if BUILD_CHANNEL and BUILD_SHA else "")
    or (BUILD_CHANNEL if BUILD_CHANNEL else f"v{APP_VERSION}")
)

APP_START_TIME = datetime.now(timezone.utc)
