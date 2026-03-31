from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from backend.api.auth import verify_collector_key
from backend.database import get_session
from backend.models import ContainerLog

router = APIRouter(prefix="/api", tags=["logs"])

_MAX_MESSAGE_LEN = 10_000
_MAX_BATCH_SIZE = 5_000


class LogEntry(BaseModel):
    container_id: str = Field(max_length=128)
    container_name: str = Field(max_length=256)
    timestamp: str = Field(max_length=64)
    stream: Literal["stdout", "stderr"] = "stdout"
    message: str = Field(max_length=_MAX_MESSAGE_LEN)


class LogBatch(BaseModel):
    logs: List[LogEntry]

    @field_validator("logs")
    @classmethod
    def limit_batch_size(cls, v: list) -> list:
        if len(v) > _MAX_BATCH_SIZE:
            raise ValueError(
                f"Batch too large: maximum {_MAX_BATCH_SIZE} log entries per request"
            )
        return v


def _parse_dt(s: str) -> datetime:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00").split("+")[0])
    except Exception:
        return datetime.utcnow()


@router.post("/collector/logs", dependencies=[Depends(verify_collector_key)])
def ingest_logs(batch: LogBatch, session: Session = Depends(get_session)):
    for entry in batch.logs:
        log = ContainerLog(
            container_id=entry.container_id,
            container_name=entry.container_name,
            timestamp=_parse_dt(entry.timestamp),
            stream=entry.stream,
            message=entry.message,
        )
        session.add(log)
    session.commit()
    return {"inserted": len(batch.logs)}


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
