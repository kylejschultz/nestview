import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from database import get_session
from models import Container, ContainerNetworkHistory

router = APIRouter(prefix="/api/containers", tags=["containers"])


@router.get("")
def list_containers(session: Session = Depends(get_session)):
    containers = session.exec(select(Container)).all()
    result = []
    for c in containers:
        d = c.dict()
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
    d = container.dict()
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
