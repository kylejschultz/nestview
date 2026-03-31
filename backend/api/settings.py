from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from database import get_session
from models import ContainerAlertSetting

router = APIRouter(prefix="/api/settings", tags=["settings"])

# The three event types exposed in the UI.
# "die" events reuse the "crash" setting (see events.py).
ALERT_EVENT_TYPES = ("crash", "restart", "oom")


class AlertSettingPatch(BaseModel):
    container_name: str = Field(max_length=256)
    event_type: str = Field(max_length=32)
    enabled: bool

    model_config = {"json_schema_extra": {"example": {"container_name": "plex", "event_type": "crash", "enabled": False}}}


@router.get("/alerts")
def get_alert_settings(session: Session = Depends(get_session)) -> List[dict]:
    rows = session.exec(select(ContainerAlertSetting)).all()
    return [r.dict() for r in rows]


@router.patch("/alerts")
def patch_alert_setting(
    payload: AlertSettingPatch,
    session: Session = Depends(get_session),
) -> dict:
    if payload.event_type not in ALERT_EVENT_TYPES:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail=f"event_type must be one of {ALERT_EVENT_TYPES}")

    existing = session.exec(
        select(ContainerAlertSetting)
        .where(ContainerAlertSetting.container_name == payload.container_name)
        .where(ContainerAlertSetting.event_type == payload.event_type)
    ).first()

    if existing:
        existing.enabled = payload.enabled
        session.add(existing)
    else:
        existing = ContainerAlertSetting(
            container_name=payload.container_name,
            event_type=payload.event_type,
            enabled=payload.enabled,
        )
        session.add(existing)

    session.commit()
    session.refresh(existing)
    return existing.dict()
