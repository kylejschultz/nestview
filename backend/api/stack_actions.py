import logging

import docker
import docker.errors
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from database import get_session
from models import Container
from services.image_checker import check_single_container

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stacks", tags=["stack_actions"])

_VALID_STATES = {
    "stop":    {"running", "restarting", "paused"},
    "restart": {"running", "restarting", "paused", "exited"},
    "start":   {"exited", "created", "dead"},
}


def _get_project_containers(compose_project: str, session: Session) -> list[Container]:
    containers = session.exec(
        select(Container).where(Container.compose_project == compose_project)
    ).all()
    if not containers:
        raise HTTPException(status_code=404, detail=f"No containers found for project '{compose_project}'")
    return list(containers)


@router.post("/{compose_project}/stop")
def stop_stack(compose_project: str, session: Session = Depends(get_session)):
    return _run_stack_action(compose_project, "stop", session)


@router.post("/{compose_project}/start")
def start_stack(compose_project: str, session: Session = Depends(get_session)):
    return _run_stack_action(compose_project, "start", session)


@router.post("/{compose_project}/restart")
def restart_stack(compose_project: str, session: Session = Depends(get_session)):
    return _run_stack_action(compose_project, "restart", session)


@router.post("/{compose_project}/pull-restart")
def pull_restart_stack(compose_project: str, session: Session = Depends(get_session)):
    containers = _get_project_containers(compose_project, session)
    client = docker.from_env()

    pulled = 0
    pull_errors: list[str] = []

    for db_container in containers:
        try:
            client.images.pull(db_container.image)
            pulled += 1
        except Exception as exc:
            logger.warning(
                "pull-restart: failed to pull image '%s' for container '%s': %s",
                db_container.image, db_container.name, exc,
            )
            pull_errors.append(db_container.name)

    restarted = 0
    for db_container in containers:
        try:
            c = client.containers.get(db_container.docker_id)
            c.restart()
            restarted += 1
        except docker.errors.NotFound:
            logger.warning("pull-restart: container '%s' not found in Docker", db_container.name)
        except docker.errors.APIError as exc:
            logger.warning("pull-restart: failed to restart container '%s': %s", db_container.name, exc)

    for db_container in containers:
        try:
            check_single_container(db_container)
        except Exception as exc:
            logger.warning(
                "pull-restart: digest re-check failed for '%s': %s",
                db_container.name, exc,
            )

    return {
        "ok": True,
        "project": compose_project,
        "action": "pull-restart",
        "pulled": pulled,
        "restarted": restarted,
    }


def _run_stack_action(compose_project: str, action: str, session: Session) -> dict:
    containers = _get_project_containers(compose_project, session)
    valid_states = _VALID_STATES[action]
    client = docker.from_env()

    affected = 0
    for db_container in containers:
        if db_container.state not in valid_states:
            continue
        try:
            c = client.containers.get(db_container.docker_id)
            getattr(c, action)()
            affected += 1
        except docker.errors.NotFound:
            logger.warning(
                "stack %s: container '%s' not found in Docker, skipping",
                action, db_container.name,
            )
        except docker.errors.APIError as exc:
            logger.warning(
                "stack %s: failed to %s container '%s': %s",
                action, action, db_container.name, exc,
            )

    return {"ok": True, "project": compose_project, "action": action, "affected": affected}
