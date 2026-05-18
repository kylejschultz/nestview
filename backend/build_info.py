import os
from datetime import datetime, timezone
from pathlib import Path

_version_file = Path("/app/VERSION")
_raw_version = _version_file.read_text().strip() if _version_file.exists() else "dev"
_build_channel = os.environ.get("BUILD_CHANNEL", "")
APP_VERSION = f"{_raw_version}-{_build_channel}" if _build_channel else _raw_version
_raw_sha = os.environ.get("BUILD_SHA", "")
BUILD_SHA: str | None = _raw_sha if _raw_sha and _raw_sha != "unknown" else None

APP_START_TIME = datetime.now(timezone.utc)
