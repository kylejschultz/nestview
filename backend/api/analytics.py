from fastapi import APIRouter, Depends
from sqlmodel import Session

from database import get_session
from services.app_settings import get_setting, set_setting

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _status_response(session: Session) -> dict:
    enabled = get_setting(session, "analytics_enabled") == "true"
    install_id = (get_setting(session, "install_id") or "") if enabled else ""
    return {"analytics_enabled": enabled, "install_id": install_id}


@router.get("/status")
def analytics_status(session: Session = Depends(get_session)) -> dict:
    return _status_response(session)


@router.post("/opt-in")
def analytics_opt_in(session: Session = Depends(get_session)) -> dict:
    set_setting(session, "analytics_enabled", "true")
    session.commit()
    return _status_response(session)


@router.post("/opt-out")
def analytics_opt_out(session: Session = Depends(get_session)) -> dict:
    set_setting(session, "analytics_enabled", "false")
    session.commit()
    return _status_response(session)
