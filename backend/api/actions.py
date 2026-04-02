from typing import Literal

import docker
import docker.errors
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from api.auth import verify_api_key
from database import get_session
from models import Container

router = APIRouter(prefix="/api/containers", tags=["actions"])

Action = Literal["start", "stop", "restart"]

# States that make each action valid
_VALID_STATES: dict[Action, set[str]] = {
    "stop":    {"running", "restarting", "paused"},
    "restart": {"running", "restarting", "paused", "exited"},
    "start":   {"exited", "created", "dead"},
}


def _get_db_container(docker_id: str, session: Session) -> Container:
    container = session.exec(
        select(Container).where(Container.docker_id == docker_id)
    ).first()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    return container


@router.post("/{docker_id}/stop", dependencies=[Depends(verify_api_key)])
def stop_container(docker_id: str, session: Session = Depends(get_session)):
    return _run_action(docker_id, "stop", session)


@router.post("/{docker_id}/restart", dependencies=[Depends(verify_api_key)])
def restart_container(docker_id: str, session: Session = Depends(get_session)):
    return _run_action(docker_id, "restart", session)


@router.post("/{docker_id}/start", dependencies=[Depends(verify_api_key)])
def start_container(docker_id: str, session: Session = Depends(get_session)):
    return _run_action(docker_id, "start", session)


def _run_action(docker_id: str, action: Action, session: Session) -> dict:
    db_container = _get_db_container(docker_id, session)

    valid_states = _VALID_STATES[action]
    if db_container.state not in valid_states:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot {action} container '{db_container.name}': "
                f"current state is '{db_container.state}' "
                f"(valid states: {', '.join(sorted(valid_states))})"
            ),
        )

    try:
        client = docker.from_env()
        c = client.containers.get(docker_id)
        getattr(c, action)()
    except docker.errors.NotFound:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Container '{db_container.name}' was not found in Docker. "
                "It may have been removed since the last collector poll."
            ),
        )
    except docker.errors.APIError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"ok": True, "action": action, "container": db_container.name}
