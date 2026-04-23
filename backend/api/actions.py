import logging
from typing import Literal

import docker
import docker.errors
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from constants import _VALID_STATES
from database import get_session
from models import Container
from services.image_checker import check_single_container

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/containers", tags=["actions"])

Action = Literal["start", "stop", "restart"]

_UPDATE_RESTART_VALID_STATES = {"running", "restarting", "paused"}


def _get_db_container(docker_id: str, session: Session) -> Container:
    container = session.exec(
        select(Container).where(Container.docker_id == docker_id)
    ).first()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    return container


@router.post("/{docker_id}/stop")
def stop_container(docker_id: str, session: Session = Depends(get_session)):
    return _run_action(docker_id, "stop", session)


@router.post("/{docker_id}/restart")
def restart_container(docker_id: str, session: Session = Depends(get_session)):
    return _run_action(docker_id, "restart", session)


@router.post("/{docker_id}/start")
def start_container(docker_id: str, session: Session = Depends(get_session)):
    return _run_action(docker_id, "start", session)


@router.post("/{docker_id}/check-for-updates")
def check_for_updates(docker_id: str, session: Session = Depends(get_session)):
    db_container = _get_db_container(docker_id, session)
    check_single_container(db_container)
    # check_single_container opens its own session; expire and re-fetch to read updated fields
    session.expire(db_container)
    session.refresh(db_container)
    return {
        "ok": True,
        "action": "check-for-updates",
        "container": db_container.name,
        "update_available": db_container.update_available,
    }


@router.post("/{docker_id}/update-and-restart")
def update_and_restart(docker_id: str, session: Session = Depends(get_session)):
    db_container = _get_db_container(docker_id, session)

    if db_container.state not in _UPDATE_RESTART_VALID_STATES:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot update-and-restart container '{db_container.name}': "
                f"current state is '{db_container.state}' "
                f"(valid states: {', '.join(sorted(_UPDATE_RESTART_VALID_STATES))})"
            ),
        )

    old_image_digest = db_container.image_digest

    try:
        client = docker.from_env()
        client.images.pull(db_container.image)
    except docker.errors.APIError as exc:
        raise HTTPException(status_code=500, detail=f"Image fetch failed: {exc}")

    # Re-check digest to determine whether the fetch actually changed the local image
    try:
        check_single_container(db_container)
    except Exception as exc:
        logger.warning("update-and-restart: digest re-check failed for %r: %s", db_container.name, exc)

    session.expire(db_container)
    session.refresh(db_container)

    if db_container.image_digest == old_image_digest:
        # Image did not change — already up to date, skip restart
        return {
            "ok": True,
            "action": "update-and-restart",
            "container": db_container.name,
            "update_available": db_container.update_available,
            "restarted": False,
        }

    try:
        c = client.containers.get(docker_id)
        c.restart()
    except docker.errors.NotFound:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Container '{db_container.name}' was not found in Docker after update. "
                "It may have been removed since the last collector poll."
            ),
        )
    except docker.errors.APIError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "ok": True,
        "action": "update-and-restart",
        "container": db_container.name,
        "update_available": db_container.update_available,
        "restarted": True,
    }


def _run_action(docker_id: str, action: str, session: Session) -> dict:
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
