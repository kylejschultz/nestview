import logging
from datetime import datetime
from typing import Literal

import docker
import docker.errors
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import update as sa_update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from constants import _VALID_STATES
from database import get_session
from limiter import limiter
from models import Container, ContainerEvent, ContainerLog, ContainerMetricsHistory, ContainerNetworkHistory, Operation
from services.docker_recreate import recreate_container_with_current_config
from services.image_checker import check_single_container
from services.operations import create_operation, find_running_operation, update_operation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/containers", tags=["actions"])

Action = Literal["start", "stop", "restart"]

_UPDATE_RESTART_VALID_STATES = {"running", "restarting", "paused"}


def _operation_error_detail(message: str, operation: Operation | None = None) -> dict:
    detail = {"message": message}
    if operation is not None:
        detail["operation_id"] = operation.operation_id
        detail["phase"] = operation.phase
    return detail


def _get_db_container(docker_id: str, session: Session) -> Container:
    container = session.exec(
        select(Container).where(Container.docker_id == docker_id)
    ).first()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    return container


def _image_id_from_pull_result(pulled_image) -> str | None:
    image_id = getattr(pulled_image, "id", None)
    if image_id:
        return image_id

    attrs = getattr(pulled_image, "attrs", None)
    if isinstance(attrs, dict):
        value = attrs.get("Id")
        if isinstance(value, str) and value:
            return value

    return None


def _local_image_id(client, image_ref: str) -> str | None:
    try:
        image = client.images.get(image_ref)
    except Exception:
        return None
    return _image_id_from_pull_result(image)


def _reassociate_container_after_recreate(
    session: Session,
    db_container: Container,
    new_docker_id: str,
) -> None:
    old_docker_id = db_container.docker_id
    if new_docker_id == old_docker_id:
        return

    session.exec(
        sa_update(ContainerNetworkHistory)
        .where(ContainerNetworkHistory.container_id == old_docker_id)
        .values(container_id=new_docker_id)
    )
    session.exec(
        sa_update(ContainerMetricsHistory)
        .where(ContainerMetricsHistory.docker_id == old_docker_id)
        .values(docker_id=new_docker_id)
    )
    session.exec(
        sa_update(ContainerLog)
        .where(ContainerLog.container_id == old_docker_id)
        .values(container_id=new_docker_id)
    )
    session.exec(
        sa_update(ContainerEvent)
        .where(ContainerEvent.container_id == old_docker_id)
        .values(container_id=new_docker_id)
    )

    db_container.docker_id = new_docker_id
    db_container.short_id = new_docker_id[:12]
    db_container.previous_docker_id = old_docker_id
    db_container.last_seen = datetime.utcnow()
    session.add(db_container)
    session.add(ContainerEvent(
        container_id=new_docker_id,
        container_name=db_container.name,
        event_type="recreated",
        details=f"Container recreated: {old_docker_id[:12]} -> {new_docker_id[:12]}",
        timestamp=datetime.utcnow(),
        alerted=False,
    ))
    session.commit()


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
@limiter.limit("10/minute")
def check_for_updates(request: Request, docker_id: str, session: Session = Depends(get_session)):
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
@limiter.limit("5/minute")
def update_and_restart(request: Request, docker_id: str, session: Session = Depends(get_session)):
    db_container = _get_db_container(docker_id, session)
    active_operation = find_running_operation(
        session,
        operation_type="update-and-restart",
        target_type="container",
        target_id=docker_id,
    )
    if active_operation is not None:
        raise HTTPException(
            status_code=409,
            detail=_operation_error_detail(
                f"Update-and-restart already running for container '{db_container.name}'",
                active_operation,
            ),
        )

    try:
        operation = create_operation(
            session,
            operation_type="update-and-restart",
            target_type="container",
            target_id=docker_id,
            target_name=db_container.name,
            phase="validating",
        )
    except IntegrityError:
        session.rollback()
        active_operation = find_running_operation(
            session,
            operation_type="update-and-restart",
            target_type="container",
            target_id=docker_id,
        )
        raise HTTPException(
            status_code=409,
            detail=_operation_error_detail(
                f"Update-and-restart already running for container '{db_container.name}'",
                active_operation,
            ),
        )

    if db_container.state not in _UPDATE_RESTART_VALID_STATES:
        detail = (
            f"Cannot update-and-restart container '{db_container.name}': "
            f"current state is '{db_container.state}' "
            f"(valid states: {', '.join(sorted(_UPDATE_RESTART_VALID_STATES))})"
        )
        update_operation(session, operation, status="failed", phase="validation-failed", error=detail)
        raise HTTPException(
            status_code=409,
            detail=_operation_error_detail(detail, operation),
        )

    if db_container.update_available is False:
        result = {
            "ok": True,
            "action": "update-and-restart",
            "container": db_container.name,
            "update_available": False,
            "restarted": False,
            "skipped_reason": "already-current",
        }
        update_operation(session, operation, status="skipped", phase="already-current", result=result)
        return {**result, "operation_id": operation.operation_id}

    old_running_image_digest = db_container.image_digest

    try:
        update_operation(session, operation, phase="pulling")
        client = docker.from_env()
        pulled_image = client.images.pull(db_container.image)
        pulled_image_digest = _image_id_from_pull_result(pulled_image) or _local_image_id(client, db_container.image)
    except docker.errors.APIError as exc:
        detail = f"Image fetch failed: {exc}"
        update_operation(session, operation, status="failed", phase="pull-failed", error=str(exc))
        raise HTTPException(status_code=500, detail=_operation_error_detail(detail, operation))

    # Re-check digest to determine whether the fetch actually changed the local image
    try:
        update_operation(session, operation, phase="verifying")
        check_single_container(db_container)
    except Exception as exc:
        logger.warning("update-and-restart: digest re-check failed for %r: %s", db_container.name, exc)
        detail = f"Digest verification failed after image fetch: {exc}"
        update_operation(session, operation, status="failed", phase="verification-failed", error=str(exc))
        raise HTTPException(status_code=500, detail=_operation_error_detail(detail, operation))

    session.expire(db_container)
    session.refresh(db_container)

    if pulled_image_digest and old_running_image_digest and pulled_image_digest == old_running_image_digest:
        # Image did not change — already up to date, skip restart
        result = {
            "ok": True,
            "action": "update-and-restart",
            "container": db_container.name,
            "update_available": db_container.update_available,
            "restarted": False,
            "skipped_reason": "digest-unchanged-after-pull",
        }
        update_operation(session, operation, status="skipped", phase="already-current", result=result)
        return {**result, "operation_id": operation.operation_id}

    try:
        update_operation(session, operation, phase="recreating")
        new_docker_id = recreate_container_with_current_config(client, docker_id, db_container.image)
    except docker.errors.NotFound:
        detail = (
            f"Container '{db_container.name}' was not found in Docker after update. "
            "It may have been removed since the last collector poll."
        )
        update_operation(session, operation, status="failed", phase="recreate-failed", error=detail)
        raise HTTPException(
            status_code=404,
            detail=_operation_error_detail(detail, operation),
        )
    except docker.errors.APIError as exc:
        detail = str(exc)
        update_operation(session, operation, status="failed", phase="recreate-failed", error=detail)
        raise HTTPException(status_code=500, detail=_operation_error_detail(detail, operation))
    except Exception as exc:
        detail = f"Container recreate failed: {exc}"
        update_operation(session, operation, status="failed", phase="recreate-failed", error=str(exc))
        raise HTTPException(status_code=500, detail=_operation_error_detail(detail, operation))

    update_operation(session, operation, phase="confirming")
    _reassociate_container_after_recreate(session, db_container, new_docker_id)
    result = {
        "ok": True,
        "action": "update-and-restart",
        "container": db_container.name,
        "update_available": db_container.update_available,
        "restarted": True,
        "new_docker_id": new_docker_id,
    }
    update_operation(session, operation, status="succeeded", phase="complete", result=result)
    return {**result, "operation_id": operation.operation_id}


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
