import json
import logging
import smtplib
from datetime import datetime
from email.message import EmailMessage
from typing import Any

import httpx
from sqlmodel import Session, select

from models import NotificationDestination
from services import discord
from services.app_settings import get_setting

logger = logging.getLogger(__name__)

DESTINATION_TYPES = ("discord", "slack", "email", "webhook")


def _load_config(destination: NotificationDestination) -> dict[str, Any]:
    try:
        value = json.loads(destination.config_json or "{}")
    except json.JSONDecodeError:
        logger.warning("notification destination %s has invalid config JSON", destination.id)
        return {}
    return value if isinstance(value, dict) else {}


def _alert_title(event_type: str) -> str:
    return discord.EVENT_TITLES.get(event_type, f"Container Event: {event_type}")


def _alert_text(container_name: str, event_type: str, details: str | None = None) -> str:
    text = f"{_alert_title(event_type)}: {container_name}"
    if details:
        text = f"{text} ({details})"
    return text


async def _send_slack(config: dict[str, Any], container_name: str, event_type: str, details: str | None, timestamp: datetime | None) -> bool:
    webhook_url = str(config.get("webhook_url") or "")
    if not webhook_url:
        return False

    text = _alert_text(container_name, event_type, details)
    payload = {
        "text": text,
        "blocks": [
            {"type": "header", "text": {"type": "plain_text", "text": _alert_title(event_type)}},
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Container*\n`{container_name}`"},
                    {"type": "mrkdwn", "text": f"*Event*\n{event_type}"},
                ],
            },
        ],
    }
    if details:
        payload["blocks"].append({"type": "section", "text": {"type": "mrkdwn", "text": f"*Details*\n{details}"}})
    if timestamp:
        payload["blocks"].append({"type": "context", "elements": [{"type": "mrkdwn", "text": f"Nestview • {timestamp.isoformat()}"}]})

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(webhook_url, json=payload, timeout=10)
            return 200 <= resp.status_code < 300
    except Exception as exc:
        logger.warning("Slack notification failed: %s", type(exc).__name__)
        return False


async def _send_webhook(config: dict[str, Any], container_name: str, event_type: str, details: str | None, timestamp: datetime | None) -> bool:
    webhook_url = str(config.get("webhook_url") or "")
    if not webhook_url:
        return False

    payload = {
        "source": "nestview",
        "event_type": event_type,
        "title": _alert_title(event_type),
        "container_name": container_name,
        "details": details,
        "timestamp": (timestamp or datetime.utcnow()).isoformat(),
    }
    headers = {"Content-Type": "application/json"}
    secret = str(config.get("secret") or "")
    if secret:
        headers["X-Nestview-Secret"] = secret

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(webhook_url, json=payload, headers=headers, timeout=10)
            return 200 <= resp.status_code < 300
    except Exception as exc:
        logger.warning("Generic webhook notification failed: %s", type(exc).__name__)
        return False


def _send_email(config: dict[str, Any], container_name: str, event_type: str, details: str | None, timestamp: datetime | None) -> bool:
    host = str(config.get("host") or "")
    port = int(config.get("port") or 587)
    sender = str(config.get("from_email") or "")
    recipients = [item.strip() for item in str(config.get("to_emails") or "").split(",") if item.strip()]
    if not host or not sender or not recipients:
        return False

    msg = EmailMessage()
    msg["Subject"] = f"Nestview: {_alert_title(event_type)}"
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)
    body = _alert_text(container_name, event_type, details)
    if timestamp:
        body = f"{body}\n\nTimestamp: {timestamp.isoformat()}"
    msg.set_content(body)

    username = str(config.get("username") or "")
    password = str(config.get("password") or "")
    use_tls = bool(config.get("use_tls", True))

    try:
        with smtplib.SMTP(host, port, timeout=10) as smtp:
            if use_tls:
                smtp.starttls()
            if username:
                smtp.login(username, password)
            smtp.send_message(msg)
        return True
    except Exception as exc:
        logger.warning("Email notification failed: %s", type(exc).__name__)
        return False


async def _send_destination(destination: NotificationDestination, container_name: str, event_type: str, details: str | None, timestamp: datetime | None) -> bool:
    config = _load_config(destination)
    if destination.destination_type == "discord":
        return await discord.send_alert(
            webhook_url=str(config.get("webhook_url") or ""),
            container_name=container_name,
            event_type=event_type,
            details=details,
            timestamp=timestamp,
        )
    if destination.destination_type == "slack":
        return await _send_slack(config, container_name, event_type, details, timestamp)
    if destination.destination_type == "webhook":
        return await _send_webhook(config, container_name, event_type, details, timestamp)
    if destination.destination_type == "email":
        return _send_email(config, container_name, event_type, details, timestamp)
    return False


def _configured_destinations(session: Session) -> list[NotificationDestination]:
    destinations = session.exec(
        select(NotificationDestination).where(NotificationDestination.enabled == True)  # noqa: E712
    ).all()
    if destinations:
        return destinations

    # Backward compatibility for databases that have not migrated yet or setup
    # flows that still write only the legacy Discord setting.
    webhook_url = get_setting(session, "discord_webhook_url") or ""
    if webhook_url:
        return [
            NotificationDestination(
                name="Discord",
                destination_type="discord",
                enabled=True,
                config_json=json.dumps({"webhook_url": webhook_url}),
            )
        ]
    return []


async def send_alert(session: Session, container_name: str, event_type: str, details: str | None = None, timestamp: datetime | None = None) -> bool:
    sent_any = False
    for destination in _configured_destinations(session):
        try:
            sent_any = await _send_destination(destination, container_name, event_type, details, timestamp) or sent_any
        except Exception as exc:
            logger.warning(
                "notification destination failed: type=%s error=%s",
                destination.destination_type,
                type(exc).__name__,
            )
    return sent_any


async def send_test(destination: NotificationDestination) -> bool:
    return await _send_destination(
        destination,
        container_name="nestview-test",
        event_type="restart",
        details="Test notification from Nestview.",
        timestamp=datetime.utcnow(),
    )
