import os
import tempfile
from pathlib import Path

os.environ.setdefault(
    "DATABASE_PATH",
    str(Path(tempfile.gettempdir()) / "nestview-test-image-checker.db"),
)

from sqlmodel import Session, SQLModel, create_engine

from models import Container
from services import image_checker


def _container() -> Container:
    return Container(
        docker_id="docker-1",
        short_id="docker-1",
        name="app",
        image="nginx:alpine",
        status="running",
        state="running",
    )


def test_check_container_uses_running_image_not_mutable_local_tag(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)

    monkeypatch.setattr(
        image_checker,
        "_get_local_image_attrs",
        lambda _image_ref: (
            "sha256:local-current",
            123,
            None,
            ["nginx@sha256:registry-current"],
        ),
    )
    monkeypatch.setattr(
        image_checker,
        "_get_running_image_attrs",
        lambda _docker_id: (
            "sha256:running-old",
            ["nginx@sha256:registry-old"],
        ),
    )
    monkeypatch.setattr(
        image_checker,
        "_fetch_registry_digest",
        lambda *_args: "sha256:registry-current",
    )

    with Session(engine) as session:
        container = _container()
        image_checker._check_container(session, container)

    assert container.image_digest == "sha256:running-old"
    assert container.registry_digest == "sha256:registry-current"
    assert container.update_available is True


def test_check_container_marks_current_when_running_image_matches_registry(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)

    monkeypatch.setattr(
        image_checker,
        "_get_local_image_attrs",
        lambda _image_ref: (
            "sha256:local-old",
            123,
            None,
            ["nginx@sha256:registry-old"],
        ),
    )
    monkeypatch.setattr(
        image_checker,
        "_get_running_image_attrs",
        lambda _docker_id: (
            "sha256:running-current",
            ["nginx@sha256:registry-current"],
        ),
    )
    monkeypatch.setattr(
        image_checker,
        "_fetch_registry_digest",
        lambda *_args: "sha256:registry-current",
    )

    with Session(engine) as session:
        container = _container()
        image_checker._check_container(session, container)

    assert container.image_digest == "sha256:running-current"
    assert container.registry_digest == "sha256:registry-current"
    assert container.update_available is False
