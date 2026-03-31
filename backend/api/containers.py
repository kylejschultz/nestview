import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlmodel import Session, delete, select

from api.auth import verify_collector_key
from database import get_session
from models import Container

router = APIRouter(prefix="/api/containers", tags=["containers"])


class ContainerIn(BaseModel):
    docker_id: str
    short_id: str
    name: str
    image: str
    status: str
    state: str
    restart_count: int = 0
    cpu_percent: float = 0.0
    mem_usage: int = 0
    mem_limit: int = 0
    ports: str = "[]"
    volumes: str = "[]"
    networks: str = "[]"
    compose_project: Optional[str] = None
    compose_service: Optional[str] = None
    created_at: Optional[str] = None
    started_at: Optional[str] = None


class ContainerBatch(BaseModel):
    containers: List[ContainerIn]
    # When True (the default), any container row in the DB whose docker_id is
    # NOT present in this batch is deleted.  The collector always sends a
    # complete `docker ps -a` snapshot, so this is safe and keeps the DB in
    # sync with Docker reality.
    reconcile: bool = True

    @field_validator("containers")
    @classmethod
    def limit_batch_size(cls, v: list) -> list:
        if len(v) > 500:
            raise ValueError("Batch too large: maximum 500 containers per request")
        return v


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00").split("+")[0])
    except Exception:
        return None


@router.post("/batch", dependencies=[Depends(verify_collector_key)])
def upsert_containers(batch: ContainerBatch, session: Session = Depends(get_session)):
    seen_ids = set()
    for c in batch.containers:
        seen_ids.add(c.docker_id)
        existing = session.exec(
            select(Container).where(Container.docker_id == c.docker_id)
        ).first()

        if existing:
            existing.name = c.name
            existing.image = c.image
            existing.status = c.status
            existing.state = c.state
            existing.restart_count = c.restart_count
            existing.cpu_percent = c.cpu_percent
            existing.mem_usage = c.mem_usage
            existing.mem_limit = c.mem_limit
            existing.ports = c.ports
            existing.volumes = c.volumes
            existing.networks = c.networks
            existing.compose_project = c.compose_project
            existing.compose_service = c.compose_service
            existing.started_at = _parse_dt(c.started_at)
            existing.last_seen = datetime.utcnow()
            session.add(existing)
        else:
            new_container = Container(
                docker_id=c.docker_id,
                short_id=c.short_id,
                name=c.name,
                image=c.image,
                status=c.status,
                state=c.state,
                restart_count=c.restart_count,
                cpu_percent=c.cpu_percent,
                mem_usage=c.mem_usage,
                mem_limit=c.mem_limit,
                ports=c.ports,
                volumes=c.volumes,
                networks=c.networks,
                compose_project=c.compose_project,
                compose_service=c.compose_service,
                created_at=_parse_dt(c.created_at),
                started_at=_parse_dt(c.started_at),
                last_seen=datetime.utcnow(),
            )
            session.add(new_container)

    # Reconcile: purge any DB row whose docker_id was not in this snapshot.
    # Guard: skip when the batch is empty to avoid accidentally wiping the
    # table if the Docker daemon is temporarily unreachable.
    purged = 0
    if batch.reconcile and seen_ids:
        result = session.exec(
            delete(Container).where(Container.docker_id.notin_(seen_ids))
        )
        purged = result.rowcount

    session.commit()
    return {"updated": len(batch.containers), "purged": purged}


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
