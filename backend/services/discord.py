import os
import httpx
from datetime import datetime

WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")

EVENT_COLORS = {
    "crash": 0xEF4444,
    "die": 0xEF4444,
    "stop": 0xF97316,
    "kill": 0xF97316,
    "oom": 0xA855F7,
    "restart": 0xEAB308,
    "start": 0x22C55E,
}

EVENT_TITLES = {
    "crash": "Container Crashed",
    "die": "Container Stopped",
    "stop": "Container Stopped",
    "kill": "Container Killed",
    "oom": "Container OOM Killed",
    "restart": "Container Restarted",
    "start": "Container Started",
}


async def send_alert(
    container_name: str,
    event_type: str,
    details: str | None = None,
    timestamp: datetime | None = None,
) -> bool:
    if not WEBHOOK_URL:
        return False

    ts = timestamp or datetime.utcnow()
    color = EVENT_COLORS.get(event_type, 0x6366F1)
    title = EVENT_TITLES.get(event_type, f"Container Event: {event_type}")

    fields = [{"name": "Container", "value": f"`{container_name}`", "inline": True}]
    if details:
        fields.append({"name": "Details", "value": details, "inline": True})

    payload = {
        "embeds": [
            {
                "title": title,
                "color": color,
                "fields": fields,
                "footer": {"text": "Nestview"},
                "timestamp": ts.isoformat(),
            }
        ]
    }

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(WEBHOOK_URL, json=payload, timeout=10)
            return resp.status_code in (200, 204)
    except Exception as e:
        # Do not log the exception directly — httpx errors can include the full
        # webhook URL (which is a secret) in the message string.
        print(f"Discord alert failed: {type(e).__name__}")
        return False
