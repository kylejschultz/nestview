from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from database import get_session
from models import ContainerAlertSetting
from services.app_settings import get_setting, set_setting
from services import discord

router = APIRouter(prefix="/api/settings", tags=["settings"])

# The three event types exposed in the UI.
# "die" events reuse the "crash" setting (see events.py).
ALERT_EVENT_TYPES = ("crash", "restart", "oom")

_DEFAULT_LOG_RETENTION_DAYS = 7


# ── Alert settings ─────────────────────────────────────────────────────────────

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


# ── General settings ───────────────────────────────────────────────────────────

class GeneralSettingsPatch(BaseModel):
    discord_webhook_url: str | None = None
    log_retention_days: int | None = None

    @field_validator("discord_webhook_url")
    @classmethod
    def validate_webhook_url(cls, v: str | None) -> str | None:
        if v is None:
            return v
        # Allow empty string to clear the webhook
        if v == "":
            return v
        if not v.startswith("https://discord.com/webhooks/"):
            raise ValueError("Webhook URL must start with https://discord.com/webhooks/")
        return v

    @field_validator("log_retention_days")
    @classmethod
    def validate_retention(cls, v: int | None) -> int | None:
        if v is None:
            return v
        if not (1 <= v <= 365):
            raise ValueError("log_retention_days must be between 1 and 365")
        return v


@router.get("/general")
def get_general_settings(session: Session = Depends(get_session)) -> dict:
    webhook = get_setting(session, "discord_webhook_url") or ""
    retention_str = get_setting(session, "log_retention_days")
    retention = int(retention_str) if retention_str else _DEFAULT_LOG_RETENTION_DAYS
    return {
        "discord_webhook_url": webhook,
        "log_retention_days": retention,
    }


@router.patch("/general")
def patch_general_settings(
    payload: GeneralSettingsPatch,
    session: Session = Depends(get_session),
) -> dict:
    if payload.discord_webhook_url is not None:
        set_setting(session, "discord_webhook_url", payload.discord_webhook_url)
    if payload.log_retention_days is not None:
        set_setting(session, "log_retention_days", str(payload.log_retention_days))
    session.commit()

    # Return updated values
    webhook = get_setting(session, "discord_webhook_url") or ""
    retention_str = get_setting(session, "log_retention_days")
    retention = int(retention_str) if retention_str else _DEFAULT_LOG_RETENTION_DAYS
    return {
        "discord_webhook_url": webhook,
        "log_retention_days": retention,
    }


# ── Wizard ─────────────────────────────────────────────────────────────────────

@router.get("/wizard")
def get_wizard_status(session: Session = Depends(get_session)) -> dict:
    dismissed = get_setting(session, "wizard_dismissed")
    webhook = get_setting(session, "discord_webhook_url") or ""
    completed = bool(dismissed) or bool(webhook)
    return {"completed": completed}


@router.post("/wizard/dismiss")
def dismiss_wizard(session: Session = Depends(get_session)) -> dict:
    set_setting(session, "wizard_dismissed", "true")
    session.commit()
    return {"ok": True}


# ── Test webhook ───────────────────────────────────────────────────────────────

@router.post("/test-webhook")
async def test_webhook(session: Session = Depends(get_session)) -> dict:
    webhook_url = get_setting(session, "discord_webhook_url") or ""
    if not webhook_url:
        raise HTTPException(status_code=400, detail="No webhook URL configured")

    ok = await discord.send_test_embed(webhook_url)
    if ok:
        return {"ok": True}
    return {"ok": False, "error": "Discord returned an error. Check the webhook URL and try again."}
