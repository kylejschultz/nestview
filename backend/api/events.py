from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.database import get_session
from backend.models import ContainerEvent
from backend.services import discord

router = APIRouter(prefix="/api", tags=["events"])

ALERT_EVENT_TYPES = {"crash", "die", "oom", "restart"}


class EventIn(BaseModel):
    container_id: str
    container_name: str
    event_type: str
    details: Optional[str] = None
    timestamp: Optional[str] = None


def _parse_dt(s: Optional[str]) -> datetime:
    if not s:
        return datetime.utcnow()
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00").split("+")[0])
    except Exception:
        return datetime.utcnow()


@router.post("/collector/events")
async def ingest_event(event: EventIn, session: Session = Depends(get_session)):
    ts = _parse_dt(event.timestamp)

    db_event = ContainerEvent(
        container_id=event.container_id,
        container_name=event.container_name,
        event_type=event.event_type,
        details=event.details,
        timestamp=ts,
        alerted=False,
    )
    session.add(db_event)
    session.commit()
    session.refresh(db_event)

    if event.event_type in ALERT_EVENT_TYPES:
        alerted = await discord.send_alert(
            container_name=event.container_name,
            event_type=event.event_type,
            details=event.details,
            timestamp=ts,
        )
        if alerted:
            db_event.alerted = True
            session.add(db_event)
            session.commit()

    return {"id": db_event.id}


@router.get("/events")
def list_events(
    container_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    session: Session = Depends(get_session),
):
    query = select(ContainerEvent).order_by(ContainerEvent.timestamp.desc())
    if container_id:
        query = query.where(ContainerEvent.container_id == container_id)
    query = query.limit(limit)
    events = session.exec(query).all()
    return [e.dict() for e in events]
