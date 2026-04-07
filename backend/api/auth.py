import os

from fastapi import Header, HTTPException

_COLLECTOR_KEY = os.getenv("NESTVIEW_COLLECTOR_KEY", "")


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
