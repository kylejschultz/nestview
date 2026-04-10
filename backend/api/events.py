from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from database import get_session
from models import ContainerEvent

router = APIRouter(prefix="/api", tags=["events"])


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
