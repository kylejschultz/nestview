import csv
import io
import os
import re
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from database import get_session
from models import ContainerLog

_LOG_EXPORT_MAX_LINES = int(os.getenv("LOG_EXPORT_MAX_LINES", "50000"))

router = APIRouter(prefix="/api", tags=["logs"])


@router.get("/containers/{docker_id}/logs")
def get_container_logs(
    docker_id: str,
    search: Optional[str] = Query(None, max_length=256),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    query = select(ContainerLog).where(ContainerLog.container_id == docker_id)

    if search:
        query = query.where(ContainerLog.message.contains(search))

    query = query.order_by(ContainerLog.timestamp.desc()).offset(offset).limit(limit)
    logs = session.exec(query).all()
    return [l.dict() for l in reversed(logs)]


@router.get("/logs/export")
def export_container_logs(
    container_id: str = Query(...),
    format: Literal["txt", "csv"] = Query("txt"),
    since: Optional[str] = Query(None),
    session: Session = Depends(get_session),
):
    query = select(ContainerLog).where(ContainerLog.container_id == container_id)

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            query = query.where(ContainerLog.timestamp >= since_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'since' timestamp — use ISO 8601 format")

    query = query.order_by(ContainerLog.timestamp.asc()).limit(_LOG_EXPORT_MAX_LINES)
    logs = session.exec(query).all()

    safe_id = container_id[:12]
    raw_name = logs[0].container_name.lstrip("/") if logs else safe_id
    safe_name = re.sub(r"[^\w\-]", "_", raw_name)
    filename = f"nestview-logs-{safe_name}-{safe_id}.{format}"

    if format == "csv":
        def generate_csv():
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow(["timestamp", "stream", "message"])
            yield buf.getvalue()
            for log in logs:
                buf = io.StringIO()
                writer = csv.writer(buf)
                writer.writerow([log.timestamp.isoformat(), log.stream, log.message])
                yield buf.getvalue()

        return StreamingResponse(
            generate_csv(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    else:
        def generate_txt():
            for log in logs:
                yield f"{log.timestamp.isoformat()} [{log.stream}] {log.message}\n"

        return StreamingResponse(
            generate_txt(),
            media_type="text/plain",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )


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
