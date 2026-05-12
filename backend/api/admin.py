from fastapi import APIRouter, Request

from limiter import limiter
from services.image_checker import run_image_check

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/check-images")
@limiter.limit("5/minute")
def trigger_image_check(request: Request):
    """Manually trigger an image digest check for all running containers."""
    run_image_check()
    return {"status": "ok"}
