import json
from datetime import datetime
from typing import Any, Dict, List
from zoneinfo import available_timezones

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from database import get_session
from models import AppSetting, ContainerAlertSetting, NotificationDestination
from services.app_settings import get_setting, set_setting
from services import discord, notifications

router = APIRouter(prefix="/api/settings", tags=["settings"])

# The event types exposed in the UI.
# "die" events reuse the "crash" setting (see events.py).
ALERT_EVENT_TYPES = ("crash", "restart", "oom", "update_available")
DESTINATION_TYPES = ("discord", "slack", "email", "webhook")

_DEFAULT_LOG_RETENTION_DAYS = 7
_DEFAULT_EXITED_CONTAINER_TTL_SECONDS = 300
_DEFAULT_NETWORK_HISTORY_RETENTION_HOURS = 6

_NUMERIC_SETTING_KEYS = {"log_retention_days", "exited_container_ttl_seconds", "network_history_retention_hours"}

# Keys never returned by GET or PATCH /api/settings — sensitive values that must stay server-side.
_SENSITIVE_SETTING_KEYS: frozenset[str] = frozenset({
    "session_secret",
    "admin_password_hash",
    "discord_webhook_url",
    "admin_username",
})

# Allowlist of keys that may be written via the generic PATCH /api/settings endpoint.
# Prevents arbitrary key injection into the AppSetting table.
_ALLOWED_SETTING_KEYS = {
    "discord_webhook_url",
    "log_retention_days",
    "exited_container_ttl_seconds",
    "timezone",
    "wizard_dismissed",
    "image_check_enabled",
    "image_check_time",
    "session_expiry_days",
    "network_history_retention_hours",
    "analytics_prompt_seen",
}


# ── Alert settings ─────────────────────────────────────────────────────────────

class AlertSettingPatch(BaseModel):
    container_name: str = Field(max_length=256)
    event_type: str = Field(max_length=32)
    enabled: bool

    model_config = {"json_schema_extra": {"example": {"container_name": "plex", "event_type": "crash", "enabled": False}}}


@router.get("/alerts/defaults")
def get_alert_defaults(session: Session = Depends(get_session)) -> List[dict]:
    rows = session.exec(
        select(ContainerAlertSetting)
        .where(ContainerAlertSetting.container_name == "__global__")
    ).all()
    return [{"event_type": r.event_type, "enabled": r.enabled} for r in rows]


class AlertDefaultPatch(BaseModel):
    event_type: str = Field(max_length=32)
    enabled: bool


@router.patch("/alerts/defaults")
def patch_alert_defaults(
    payload: List[AlertDefaultPatch],
    session: Session = Depends(get_session),
) -> List[dict]:
    for item in payload:
        if item.event_type not in ALERT_EVENT_TYPES:
            raise HTTPException(status_code=422, detail=f"event_type must be one of {ALERT_EVENT_TYPES}")
        existing = session.exec(
            select(ContainerAlertSetting)
            .where(ContainerAlertSetting.container_name == "__global__")
            .where(ContainerAlertSetting.event_type == item.event_type)
        ).first()
        if existing:
            existing.enabled = item.enabled
            session.add(existing)
        else:
            session.add(ContainerAlertSetting(
                container_name="__global__",
                event_type=item.event_type,
                enabled=item.enabled,
            ))
    session.commit()
    return get_alert_defaults(session)


@router.get("/alerts")
def get_alert_settings(session: Session = Depends(get_session)) -> List[dict]:
    rows = session.exec(
        select(ContainerAlertSetting)
        .where(ContainerAlertSetting.container_name != "__global__")
    ).all()
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


# ── Notification destinations ─────────────────────────────────────────────────

_SECRET_CONFIG_KEYS = {"webhook_url", "password", "secret"}


class NotificationDestinationPayload(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    destination_type: str = Field(max_length=32)
    enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("destination_type")
    @classmethod
    def validate_destination_type(cls, value: str) -> str:
        if value not in DESTINATION_TYPES:
            raise ValueError(f"destination_type must be one of {DESTINATION_TYPES}")
        return value


class NotificationDestinationPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool | None = None
    config: dict[str, Any] | None = None


def _load_destination_config(destination: NotificationDestination) -> dict[str, Any]:
    try:
        parsed = json.loads(destination.config_json or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _public_destination(destination: NotificationDestination) -> dict:
    config = _load_destination_config(destination)
    public_config = {k: v for k, v in config.items() if k not in _SECRET_CONFIG_KEYS}
    return {
        "id": destination.id,
        "name": destination.name,
        "destination_type": destination.destination_type,
        "enabled": destination.enabled,
        "configured": bool(config),
        "config": public_config,
        "created_at": destination.created_at,
        "updated_at": destination.updated_at,
    }


def _clean_destination_config(
    destination_type: str,
    config: dict[str, Any],
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    base = dict(existing or {})
    incoming = {k: v for k, v in config.items() if v is not None and v != ""}
    merged = {**base, **incoming}

    if destination_type == "discord":
        webhook_url = str(merged.get("webhook_url") or "")
        if not (webhook_url.startswith("https://discord.com/webhooks/") or webhook_url.startswith("https://discord.com/api/webhooks/")):
            raise HTTPException(status_code=422, detail="Discord webhook URL must be a Discord webhook URL.")
        return {"webhook_url": webhook_url}

    if destination_type == "slack":
        webhook_url = str(merged.get("webhook_url") or "")
        if not webhook_url.startswith("https://hooks.slack.com/services/"):
            raise HTTPException(status_code=422, detail="Slack webhook URL must start with https://hooks.slack.com/services/.")
        return {"webhook_url": webhook_url}

    if destination_type == "webhook":
        webhook_url = str(merged.get("webhook_url") or "")
        if not (webhook_url.startswith("https://") or webhook_url.startswith("http://")):
            raise HTTPException(status_code=422, detail="Webhook URL must start with http:// or https://.")
        result = {"webhook_url": webhook_url}
        secret = str(merged.get("secret") or "")
        if secret:
            result["secret"] = secret
        return result

    if destination_type == "email":
        host = str(merged.get("host") or "")
        from_email = str(merged.get("from_email") or "")
        to_emails = str(merged.get("to_emails") or "")
        if not host or not from_email or not to_emails:
            raise HTTPException(status_code=422, detail="Email destinations require host, from_email, and to_emails.")
        try:
            port = int(merged.get("port") or 587)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Email port must be a number.")
        return {
            "host": host,
            "port": port,
            "username": str(merged.get("username") or ""),
            "password": str(merged.get("password") or ""),
            "from_email": from_email,
            "to_emails": to_emails,
            "use_tls": bool(merged.get("use_tls", True)),
        }

    raise HTTPException(status_code=422, detail=f"Unknown destination type: {destination_type}")


def _upsert_discord_destination(session: Session, webhook_url: str) -> None:
    existing = session.exec(
        select(NotificationDestination)
        .where(NotificationDestination.destination_type == "discord")
    ).first()
    if webhook_url == "":
        if existing:
            existing.enabled = False
            existing.updated_at = datetime.utcnow()
            session.add(existing)
        return

    config_json = json.dumps({"webhook_url": webhook_url})
    if existing:
        existing.config_json = config_json
        existing.enabled = True
        existing.updated_at = datetime.utcnow()
        session.add(existing)
        return

    session.add(NotificationDestination(
        name="Discord",
        destination_type="discord",
        enabled=True,
        config_json=config_json,
    ))


@router.get("/notification-destinations")
def get_notification_destinations(session: Session = Depends(get_session)) -> list[dict]:
    rows = session.exec(select(NotificationDestination)).all()
    return [_public_destination(row) for row in rows]


@router.post("/notification-destinations")
def create_notification_destination(
    payload: NotificationDestinationPayload,
    session: Session = Depends(get_session),
) -> dict:
    destination = NotificationDestination(
        name=payload.name,
        destination_type=payload.destination_type,
        enabled=payload.enabled,
        config_json=json.dumps(_clean_destination_config(payload.destination_type, payload.config)),
    )
    session.add(destination)
    session.commit()
    session.refresh(destination)
    return _public_destination(destination)


@router.patch("/notification-destinations/{destination_id}")
def update_notification_destination(
    destination_id: int,
    payload: NotificationDestinationPatch,
    session: Session = Depends(get_session),
) -> dict:
    destination = session.get(NotificationDestination, destination_id)
    if destination is None:
        raise HTTPException(status_code=404, detail="Notification destination not found")
    if payload.name is not None:
        destination.name = payload.name
    if payload.enabled is not None:
        destination.enabled = payload.enabled
    if payload.config is not None:
        existing = _load_destination_config(destination)
        destination.config_json = json.dumps(_clean_destination_config(destination.destination_type, payload.config, existing))
    destination.updated_at = datetime.utcnow()
    session.add(destination)
    session.commit()
    session.refresh(destination)
    return _public_destination(destination)


@router.delete("/notification-destinations/{destination_id}")
def delete_notification_destination(
    destination_id: int,
    session: Session = Depends(get_session),
) -> dict:
    destination = session.get(NotificationDestination, destination_id)
    if destination is None:
        raise HTTPException(status_code=404, detail="Notification destination not found")
    session.delete(destination)
    session.commit()
    return {"ok": True}


@router.post("/notification-destinations/{destination_id}/test")
async def test_notification_destination(
    destination_id: int,
    session: Session = Depends(get_session),
) -> dict:
    destination = session.get(NotificationDestination, destination_id)
    if destination is None:
        raise HTTPException(status_code=404, detail="Notification destination not found")
    ok = await notifications.send_test(destination)
    if ok:
        return {"ok": True}
    return {"ok": False, "error": "Destination test failed. Check the configuration and try again."}


@router.post("/notification-destinations/test-draft")
async def test_notification_destination_draft(payload: NotificationDestinationPayload) -> dict:
    destination = NotificationDestination(
        name=payload.name,
        destination_type=payload.destination_type,
        enabled=True,
        config_json=json.dumps(_clean_destination_config(payload.destination_type, payload.config)),
    )
    ok = await notifications.send_test(destination)
    if ok:
        return {"ok": True}
    return {"ok": False, "error": "Destination test failed. Check the configuration and try again."}


# ── Generic key-value settings ────────────────────────────────────────────────

@router.get("")
def get_all_settings(session: Session = Depends(get_session)) -> Dict[str, str]:
    rows = session.exec(select(AppSetting)).all()
    return {row.key: row.value for row in rows if row.key not in _SENSITIVE_SETTING_KEYS}


@router.patch("")
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
        if key == "discord_webhook_url":
            _upsert_discord_destination(session, value)
    session.commit()
    rows = session.exec(select(AppSetting)).all()
    return {row.key: row.value for row in rows if row.key not in _SENSITIVE_SETTING_KEYS}


# ── General settings ───────────────────────────────────────────────────────────

class GeneralSettingsPatch(BaseModel):
    discord_webhook_url: str | None = None
    log_retention_days: int | None = None
    exited_container_ttl_seconds: int | None = None
    timezone: str | None = None
    network_history_retention_hours: int | None = None

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

    @field_validator("exited_container_ttl_seconds")
    @classmethod
    def validate_ttl(cls, v: int | None) -> int | None:
        if v is None:
            return v
        if v < 0:
            raise ValueError("exited_container_ttl_seconds must be >= 0")
        return v

    @field_validator("network_history_retention_hours")
    @classmethod
    def validate_net_retention(cls, v: int | None) -> int | None:
        if v is None:
            return v
        if not (1 <= v <= 48):
            raise ValueError("network_history_retention_hours must be between 1 and 48")
        return v


@router.get("/general")
def get_general_settings(session: Session = Depends(get_session)) -> dict:
    webhook = get_setting(session, "discord_webhook_url") or ""
    retention_str = get_setting(session, "log_retention_days")
    retention = int(retention_str) if retention_str else _DEFAULT_LOG_RETENTION_DAYS
    ttl_str = get_setting(session, "exited_container_ttl_seconds")
    ttl = int(ttl_str) if ttl_str else _DEFAULT_EXITED_CONTAINER_TTL_SECONDS
    timezone = get_setting(session, "timezone") or "UTC"
    net_retention_str = get_setting(session, "network_history_retention_hours")
    net_retention = int(net_retention_str) if net_retention_str else _DEFAULT_NETWORK_HISTORY_RETENTION_HOURS
    return {
        "discord_webhook_url": webhook,
        "log_retention_days": retention,
        "exited_container_ttl_seconds": ttl,
        "timezone": timezone,
        "network_history_retention_hours": net_retention,
    }


@router.patch("/general")
def patch_general_settings(
    payload: GeneralSettingsPatch,
    session: Session = Depends(get_session),
) -> dict:
    if payload.discord_webhook_url is not None:
        set_setting(session, "discord_webhook_url", payload.discord_webhook_url)
        _upsert_discord_destination(session, payload.discord_webhook_url)
    if payload.log_retention_days is not None:
        set_setting(session, "log_retention_days", str(payload.log_retention_days))
    if payload.exited_container_ttl_seconds is not None:
        set_setting(session, "exited_container_ttl_seconds", str(payload.exited_container_ttl_seconds))
    if payload.timezone is not None:
        set_setting(session, "timezone", payload.timezone)
    if payload.network_history_retention_hours is not None:
        set_setting(session, "network_history_retention_hours", str(payload.network_history_retention_hours))
    session.commit()
    return get_general_settings(session)


# ── Wizard ─────────────────────────────────────────────────────────────────────

@router.get("/wizard")
def get_wizard_status(session: Session = Depends(get_session)) -> dict:
    try:
        dismissed = get_setting(session, "wizard_dismissed")
        webhook = get_setting(session, "discord_webhook_url") or ""
        has_destination = session.exec(select(NotificationDestination)).first() is not None
        completed = bool(dismissed) or bool(webhook) or has_destination
    except Exception:
        completed = False
    return {"completed": completed}


@router.post("/wizard/dismiss")
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


@router.post("/test-webhook")
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
