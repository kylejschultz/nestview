from fastapi import APIRouter, Depends

from api.auth import verify_api_key
from services.image_checker import run_image_check

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/check-images", dependencies=[Depends(verify_api_key)])
def trigger_image_check():
    """Manually trigger an image digest check for all running containers."""
    run_image_check()
    return {"status": "ok"}
