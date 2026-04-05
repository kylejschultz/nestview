from typing import Dict, List
from zoneinfo import available_timezones

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from api.auth import verify_api_key
from database import get_session
from models import AppSetting, ContainerAlertSetting
from services.app_settings import get_setting, set_setting
from services import discord

router = APIRouter(prefix="/api/settings", tags=["settings"])

# The event types exposed in the UI.
# "die" events reuse the "crash" setting (see events.py).
ALERT_EVENT_TYPES = ("crash", "restart", "oom", "update_available")

_DEFAULT_LOG_RETENTION_DAYS = 7
_DEFAULT_EXITED_CONTAINER_TTL_HOURS = 0.083

_NUMERIC_SETTING_KEYS = {"log_retention_days", "exited_container_ttl_hours"}

# Allowlist of keys that may be written via the generic PATCH /api/settings endpoint.
# Prevents arbitrary key injection into the AppSetting table.
_ALLOWED_SETTING_KEYS = {
    "discord_webhook_url",
    "log_retention_days",
    "exited_container_ttl_hours",
    "timezone",
    "wizard_dismissed",
    "image_check_enabled",
    "image_check_time",
}


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


@router.patch("/alerts", dependencies=[Depends(verify_api_key)])
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


# ── Generic key-value settings ────────────────────────────────────────────────

@router.get("")
def get_all_settings(session: Session = Depends(get_session)) -> Dict[str, str]:
    rows = session.exec(select(AppSetting)).all()
    return {row.key: row.value for row in rows}


@router.patch("", dependencies=[Depends(verify_api_key)])
def patch_settings(
    payload: Dict[str, str],
    session: Session = Depends(get_session),
) -> Dict[str, str]:
    unknown = set(payload.keys()) - _ALLOWED_SETTING_KEYS
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown setting key(s): {', '.join(sorted(unknown))}")
    for key, value in payload.items():
        if key in _NUMERIC_SETTING_KEYS:
            try:
                float(value)
            except (ValueError, TypeError):
                raise HTTPException(status_code=422, detail=f"'{key}' must be a valid number")
        set_setting(session, key, value)
    session.commit()
    rows = session.exec(select(AppSetting)).all()
    return {row.key: row.value for row in rows}


# ── General settings ───────────────────────────────────────────────────────────

class GeneralSettingsPatch(BaseModel):
    discord_webhook_url: str | None = None
    log_retention_days: int | None = None
    exited_container_ttl_hours: float | None = None
    timezone: str | None = None

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in available_timezones():
            raise ValueError(f"'{v}' is not a valid IANA timezone name")
        return v

    @field_validator("discord_webhook_url")
    @classmethod
    def validate_webhook_url(cls, v: str | None) -> str | None:
        if v is None:
            return v
        # Allow empty string to clear the webhook
        if v == "":
            return v
        if not (v.startswith("https://discord.com/webhooks/") or
                v.startswith("https://discord.com/api/webhooks/")):
            raise ValueError("Webhook URL must start with https://discord.com/webhooks/ or https://discord.com/api/webhooks/")
        return v

    @field_validator("log_retention_days")
    @classmethod
    def validate_retention(cls, v: int | None) -> int | None:
        if v is None:
            return v
        if not (1 <= v <= 365):
            raise ValueError("log_retention_days must be between 1 and 365")
        return v

    @field_validator("exited_container_ttl_hours")
    @classmethod
    def validate_ttl(cls, v: float | None) -> float | None:
        if v is None:
            return v
        if v < 0:
            raise ValueError("exited_container_ttl_hours must be >= 0")
        return v


@router.get("/general")
def get_general_settings(session: Session = Depends(get_session)) -> dict:
    webhook = get_setting(session, "discord_webhook_url") or ""
    retention_str = get_setting(session, "log_retention_days")
    retention = int(retention_str) if retention_str else _DEFAULT_LOG_RETENTION_DAYS
    ttl_str = get_setting(session, "exited_container_ttl_hours")
    ttl = float(ttl_str) if ttl_str else _DEFAULT_EXITED_CONTAINER_TTL_HOURS
    timezone = get_setting(session, "timezone") or "UTC"
    return {
        "discord_webhook_url": webhook,
        "log_retention_days": retention,
        "exited_container_ttl_hours": ttl,
        "timezone": timezone,
    }


@router.patch("/general", dependencies=[Depends(verify_api_key)])
def patch_general_settings(
    payload: GeneralSettingsPatch,
    session: Session = Depends(get_session),
) -> dict:
    if payload.discord_webhook_url is not None:
        set_setting(session, "discord_webhook_url", payload.discord_webhook_url)
    if payload.log_retention_days is not None:
        set_setting(session, "log_retention_days", str(payload.log_retention_days))
    if payload.exited_container_ttl_hours is not None:
        set_setting(session, "exited_container_ttl_hours", str(payload.exited_container_ttl_hours))
    if payload.timezone is not None:
        set_setting(session, "timezone", payload.timezone)
    session.commit()

    # Return updated values
    webhook = get_setting(session, "discord_webhook_url") or ""
    retention_str = get_setting(session, "log_retention_days")
    retention = int(retention_str) if retention_str else _DEFAULT_LOG_RETENTION_DAYS
    ttl_str = get_setting(session, "exited_container_ttl_hours")
    ttl = float(ttl_str) if ttl_str else _DEFAULT_EXITED_CONTAINER_TTL_HOURS
    timezone = get_setting(session, "timezone") or "UTC"
    return {
        "discord_webhook_url": webhook,
        "log_retention_days": retention,
        "exited_container_ttl_hours": ttl,
        "timezone": timezone,
    }


# ── Wizard ─────────────────────────────────────────────────────────────────────

@router.get("/wizard")
def get_wizard_status(session: Session = Depends(get_session)) -> dict:
    try:
        dismissed = get_setting(session, "wizard_dismissed")
        webhook = get_setting(session, "discord_webhook_url") or ""
        completed = bool(dismissed) or bool(webhook)
    except Exception:
        completed = False
    return {"completed": completed}


@router.post("/wizard/dismiss", dependencies=[Depends(verify_api_key)])
def dismiss_wizard(session: Session = Depends(get_session)) -> dict:
    set_setting(session, "wizard_dismissed", "true")
    session.commit()
    return {"ok": True}


# ── Test webhook ───────────────────────────────────────────────────────────────

class TestWebhookBody(BaseModel):
    url: str | None = None

    @field_validator("url")
    @classmethod
    def validate_webhook_url(cls, v: str | None) -> str | None:
        # Prevent SSRF: only allow Discord webhook URLs, never arbitrary URLs.
        if v is None or v == "":
            return v
        if not (v.startswith("https://discord.com/webhooks/") or
                v.startswith("https://discord.com/api/webhooks/")):
            raise ValueError(
                "url must be a Discord webhook URL "
                "(https://discord.com/webhooks/... or https://discord.com/api/webhooks/...)"
            )
        return v


@router.post("/test-webhook", dependencies=[Depends(verify_api_key)])
async def test_webhook(
    body: TestWebhookBody = TestWebhookBody(),
    session: Session = Depends(get_session),
) -> dict:
    webhook_url = body.url or get_setting(session, "discord_webhook_url") or ""
    if not webhook_url:
        raise HTTPException(status_code=400, detail="No webhook URL configured")

    ok = await discord.send_test_embed(webhook_url)
    if ok:
        return {"ok": True}
    return {"ok": False, "error": "Discord returned an error. Check the webhook URL and try again."}
