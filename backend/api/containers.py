import json
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from database import get_session
from models import Container, ContainerMetricsHistory, ContainerNetworkHistory

router = APIRouter(prefix="/api/containers", tags=["containers"])


_CONTAINER_EXCLUDE = {"update_alert_sent_digest"}


@router.get("")
def list_containers(session: Session = Depends(get_session)):
    containers = session.exec(select(Container)).all()
    result = []
    for c in containers:
        d = c.dict(exclude=_CONTAINER_EXCLUDE)
        d["ports"] = json.loads(c.ports)
        d["volumes"] = json.loads(c.volumes)
        d["networks"] = json.loads(c.networks)
        result.append(d)
    return result


@router.get("/{docker_id}")
def get_container(docker_id: str, session: Session = Depends(get_session)):
    container = session.exec(
        select(Container).where(Container.docker_id == docker_id)
    ).first()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    d = container.dict(exclude=_CONTAINER_EXCLUDE)
    d["ports"] = json.loads(container.ports)
    d["volumes"] = json.loads(container.volumes)
    d["networks"] = json.loads(container.networks)
    return d


@router.get("/{docker_id}/network-history")
def get_network_history(docker_id: str, session: Session = Depends(get_session)):
    container = session.exec(
        select(Container).where(Container.docker_id == docker_id)
    ).first()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")

    records = session.exec(
        select(ContainerNetworkHistory)
        .where(ContainerNetworkHistory.container_id == docker_id)
        .order_by(ContainerNetworkHistory.recorded_at)
    ).all()

    return [
        {
            "recorded_at": r.recorded_at.isoformat(),
            "rx_bytes": r.rx_bytes,
            "tx_bytes": r.tx_bytes,
        }
        for r in records
    ]


@router.get("/{docker_id}/metrics-history")
def get_metrics_history(
    docker_id: str,
    hours: Optional[float] = None,
    session: Session = Depends(get_session),
):
    container = session.exec(
        select(Container).where(Container.docker_id == docker_id)
    ).first()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")

    query = (
        select(ContainerMetricsHistory)
        .where(ContainerMetricsHistory.docker_id == docker_id)
        .order_by(ContainerMetricsHistory.timestamp)
    )
    if hours is not None:
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        query = query.where(ContainerMetricsHistory.timestamp >= cutoff)

    records = session.exec(query).all()
    return [
        {
            "timestamp": r.timestamp.isoformat(),
            "cpu_percent": r.cpu_percent,
            "mem_usage_bytes": r.mem_usage_bytes,
            "mem_limit_bytes": r.mem_limit_bytes,
        }
        for r in records
    ]
