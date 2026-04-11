from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from database import get_session
from models import ContainerLog

router = APIRouter(prefix="/api", tags=["logs"])


@router.get("/containers/{docker_id}/logs")
def get_container_logs(
    docker_id: str,
    search: Optional[str] = Query(None, max_length=256),
    stream: Optional[Literal["stdout", "stderr"]] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    query = select(ContainerLog).where(ContainerLog.container_id == docker_id)

    if search:
        query = query.where(ContainerLog.message.contains(search))
    if stream:
        query = query.where(ContainerLog.stream == stream)

    query = query.order_by(ContainerLog.timestamp.desc()).offset(offset).limit(limit)
    logs = session.exec(query).all()
    return [l.dict() for l in reversed(logs)]


@router.get("/logs")
def get_all_logs(
    search: Optional[str] = Query(None, max_length=256),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    query = select(ContainerLog)
    if search:
        query = query.where(ContainerLog.message.contains(search))
    query = query.order_by(ContainerLog.timestamp.desc()).offset(offset).limit(limit)
    logs = session.exec(query).all()
    return [l.dict() for l in logs]
