import os

from fastapi import Header, HTTPException

_COLLECTOR_KEY = os.getenv("NESTVIEW_COLLECTOR_KEY", "")
_API_KEY = os.getenv("NESTVIEW_API_KEY", "")


def verify_collector_key(x_collector_key: str = Header(default="")) -> None:
    """
    Dependency used on every collector-facing POST endpoint.

    If NESTVIEW_COLLECTOR_KEY is set, the request must supply a matching
    X-Collector-Key header.  If the env var is empty the check is skipped
    (open/trusted-network mode, documented in README).
    """
    if not _COLLECTOR_KEY:
        return
    if x_collector_key != _COLLECTOR_KEY:
        raise HTTPException(status_code=403, detail="Invalid or missing collector key")


def api_key_required() -> bool:
    """Return True if NESTVIEW_API_KEY is configured."""
    return bool(_API_KEY)


def verify_api_key(x_api_key: str = Header(default="")) -> None:
    """
    Dependency used on all user-facing write endpoints (actions, settings).

    If NESTVIEW_API_KEY is set, the request must supply a matching X-API-Key
    header.  If the env var is empty the check is skipped (open mode, the
    default for trusted home-network deployments — see README for guidance).
    """
    if not _API_KEY:
        return
    if x_api_key != _API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
