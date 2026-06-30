import os
import tempfile
from pathlib import Path

os.environ.setdefault(
    "DATABASE_PATH",
    str(Path(tempfile.gettempdir()) / "nestview-test-actions.db"),
)

import docker.errors
import pytest
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

from api import actions
from models import Container, Operation

_update_and_restart = actions.update_and_restart.__wrapped__


class FakeImages:
    def __init__(self):
        self.pulled: list[str] = []

    def pull(self, image: str):
        self.pulled.append(image)


class FakeDockerContainer:
    def __init__(self):
        self.restarts = 0

    def restart(self):
        self.restarts += 1


class FakeContainers:
    def __init__(self, container: FakeDockerContainer):
        self.container = container
        self.requested_ids: list[str] = []

    def get(self, docker_id: str):
        self.requested_ids.append(docker_id)
        if docker_id == "missing":
            raise docker.errors.NotFound("missing")
        return self.container


class FakeDockerClient:
    def __init__(self):
        self.images = FakeImages()
        self.container = FakeDockerContainer()
        self.containers = FakeContainers(self.container)


@pytest.fixture()
def action_session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _add_container(
    session: Session,
    *,
    docker_id: str = "docker-1",
    state: str = "running",
    digest: str | None = "sha256:old",
) -> Container:
    container = Container(
        docker_id=docker_id,
        short_id=docker_id[:12],
        name="app",
        image="ghcr.io/example/app:latest",
        status=state,
        state=state,
        image_digest=digest,
        registry_digest=digest,
        update_available=False,
    )
    session.add(container)
    session.commit()
    session.refresh(container)
    return container


def test_update_and_restart_rejects_invalid_state_before_pull(monkeypatch, action_session):
    _add_container(action_session, state="exited")

    def fail_if_called():
        raise AssertionError("docker client should not be created for invalid states")

    monkeypatch.setattr(actions.docker, "from_env", fail_if_called)

    with pytest.raises(HTTPException) as exc:
        _update_and_restart(request=None, docker_id="docker-1", session=action_session)

    assert exc.value.status_code == 409
    assert "current state is 'exited'" in exc.value.detail

    operation = action_session.exec(select(Operation)).one()
    assert operation.status == "failed"
    assert operation.phase == "validation-failed"


def test_update_and_restart_skips_restart_when_pull_keeps_same_digest(
    monkeypatch,
    action_session,
):
    _add_container(action_session, digest="sha256:old")
    client = FakeDockerClient()

    def keep_digest_current(db_container: Container):
        db_container.image_digest = "sha256:old"
        db_container.registry_digest = "sha256:old"
        db_container.update_available = False
        action_session.add(db_container)
        action_session.commit()

    monkeypatch.setattr(actions.docker, "from_env", lambda: client)
    monkeypatch.setattr(actions, "check_single_container", keep_digest_current)

    result = _update_and_restart(
        request=None,
        docker_id="docker-1",
        session=action_session,
    )

    assert client.images.pulled == ["ghcr.io/example/app:latest"]
    assert client.container.restarts == 0
    assert result["restarted"] is False
    assert result["operation_id"]

    operation = action_session.exec(
        select(Operation).where(Operation.operation_id == result["operation_id"])
    ).first()
    assert operation is not None
    assert operation.status == "skipped"
    assert operation.phase == "already-current"


def test_update_and_restart_restarts_when_pull_changes_digest(
    monkeypatch,
    action_session,
):
    _add_container(action_session, digest="sha256:old")
    client = FakeDockerClient()
    recreated: list[tuple[str, str]] = []

    def update_digest(db_container: Container):
        db_container.image_digest = "sha256:new"
        db_container.registry_digest = "sha256:new"
        db_container.update_available = False
        action_session.add(db_container)
        action_session.commit()

    def recreate(_client, docker_id: str, image_ref: str):
        assert _client is client
        recreated.append((docker_id, image_ref))
        return "docker-2"

    monkeypatch.setattr(actions.docker, "from_env", lambda: client)
    monkeypatch.setattr(actions, "check_single_container", update_digest)
    monkeypatch.setattr(actions, "recreate_container_with_current_config", recreate)

    result = _update_and_restart(
        request=None,
        docker_id="docker-1",
        session=action_session,
    )

    assert client.images.pulled == ["ghcr.io/example/app:latest"]
    assert recreated == [("docker-1", "ghcr.io/example/app:latest")]
    assert result["restarted"] is True
    assert result["new_docker_id"] == "docker-2"
    assert result["operation_id"]

    operation = action_session.exec(
        select(Operation).where(Operation.operation_id == result["operation_id"])
    ).first()
    assert operation is not None
    assert operation.status == "succeeded"
    assert operation.phase == "complete"


def test_update_and_restart_fails_when_digest_verification_fails(
    monkeypatch,
    action_session,
):
    _add_container(action_session, digest="sha256:old")
    client = FakeDockerClient()

    monkeypatch.setattr(actions.docker, "from_env", lambda: client)
    monkeypatch.setattr(
        actions,
        "check_single_container",
        lambda _db_container: (_ for _ in ()).throw(RuntimeError("registry unavailable")),
    )

    with pytest.raises(HTTPException) as exc:
        _update_and_restart(
            request=None,
            docker_id="docker-1",
            session=action_session,
        )

    assert exc.value.status_code == 500
    assert "Digest verification failed" in exc.value.detail
    assert client.images.pulled == ["ghcr.io/example/app:latest"]
    assert client.container.restarts == 0

    operation = action_session.exec(select(Operation)).one()
    assert operation.status == "failed"
    assert operation.phase == "verification-failed"
    assert operation.error == "registry unavailable"


def test_update_and_restart_records_recreate_failure(
    monkeypatch,
    action_session,
):
    _add_container(action_session, digest="sha256:old")
    client = FakeDockerClient()

    def update_digest(db_container: Container):
        db_container.image_digest = "sha256:new"
        db_container.registry_digest = "sha256:new"
        db_container.update_available = False
        action_session.add(db_container)
        action_session.commit()

    monkeypatch.setattr(actions.docker, "from_env", lambda: client)
    monkeypatch.setattr(actions, "check_single_container", update_digest)
    monkeypatch.setattr(
        actions,
        "recreate_container_with_current_config",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("create failed")),
    )

    with pytest.raises(HTTPException) as exc:
        _update_and_restart(
            request=None,
            docker_id="docker-1",
            session=action_session,
        )

    assert exc.value.status_code == 500
    assert "Container recreate failed" in exc.value.detail

    operation = action_session.exec(select(Operation)).one()
    assert operation.status == "failed"
    assert operation.phase == "recreate-failed"
    assert operation.error == "create failed"
