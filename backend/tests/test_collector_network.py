import os
import tempfile
from datetime import datetime
from pathlib import Path

os.environ.setdefault(
    "DATABASE_PATH",
    str(Path(tempfile.gettempdir()) / "nestview-test-collector.db"),
)

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from models import AppSetting, Container, ContainerEvent, ContainerNetworkHistory
from services import collector


@pytest.fixture()
def collector_engine(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(collector, "engine", engine)
    collector._net_prev.clear()
    collector._container_started_at.clear()

    with Session(engine) as session:
        session.add(AppSetting(key="network_history_retention_hours", value="6"))
        session.commit()

    return engine


def _container_row(started_at: datetime) -> Container:
    return Container(
        docker_id="docker-1",
        short_id="docker-1",
        name="app",
        image="app:latest",
        status="running",
        state="running",
        started_at=started_at,
        net_rx_bytes=1_000,
        net_tx_bytes=2_000,
    )


def _container_data(started_at: str, rx: int, tx: int) -> dict:
    return {
        "docker_id": "docker-1",
        "short_id": "docker-1",
        "name": "app",
        "image": "app:latest",
        "status": "running",
        "state": "running",
        "restart_count": 0,
        "cpu_percent": 0.0,
        "mem_usage": 0,
        "mem_limit": 0,
        "ports": "[]",
        "volumes": "[]",
        "networks": "[]",
        "compose_project": "test-project",
        "compose_service": "app",
        "created_at": started_at,
        "started_at": started_at,
        "net_rx_bytes": rx,
        "net_tx_bytes": tx,
        "health_status": "healthy",
        "restart_policy": "unless-stopped",
        "exit_code": 0,
        "oom_killed": False,
        "finished_at": "2026-06-28T10:00:00Z",
        "container_error": None,
    }


def test_network_history_uses_persisted_counters_after_restart(collector_engine):
    started_at = "2026-06-28T10:00:00Z"
    with Session(collector_engine) as session:
        session.add(_container_row(datetime(2026, 6, 28, 10, 0, 0)))
        session.commit()

    collector._write_network_history([
        _container_data(started_at=started_at, rx=1_500, tx=2_750)
    ])

    with Session(collector_engine) as session:
        rows = session.exec(select(ContainerNetworkHistory)).all()

    assert len(rows) == 1
    assert rows[0].rx_bytes == 500
    assert rows[0].tx_bytes == 750


def test_network_history_resets_when_container_started_at_changes(collector_engine):
    with Session(collector_engine) as session:
        session.add(_container_row(datetime(2026, 6, 28, 10, 0, 0)))
        session.add(ContainerNetworkHistory(
            container_id="docker-1",
            rx_bytes=123,
            tx_bytes=456,
        ))
        session.commit()

    collector._write_network_history([
        _container_data(
            started_at="2026-06-28T11:00:00Z",
            rx=100,
            tx=200,
        )
    ])

    with Session(collector_engine) as session:
        rows = session.exec(select(ContainerNetworkHistory)).all()

    assert len(rows) == 1
    assert rows[0].rx_bytes == 0
    assert rows[0].tx_bytes == 0


def test_network_history_uses_current_counters_as_baseline_after_counter_reset(collector_engine):
    started_at = "2026-06-28T10:00:00Z"
    with Session(collector_engine) as session:
        session.add(_container_row(datetime(2026, 6, 28, 10, 0, 0)))
        session.commit()

    collector._net_prev["docker-1"] = (5_000, 8_000)

    collector._write_network_history([
        _container_data(started_at=started_at, rx=100, tx=200)
    ])
    collector._write_network_history([
        _container_data(started_at=started_at, rx=175, tx=260)
    ])

    with Session(collector_engine) as session:
        rows = session.exec(
            select(ContainerNetworkHistory)
            .order_by(ContainerNetworkHistory.recorded_at)
        ).all()

    assert len(rows) == 2
    assert rows[0].rx_bytes == 0
    assert rows[0].tx_bytes == 0
    assert rows[1].rx_bytes == 75
    assert rows[1].tx_bytes == 60


def test_apply_batch_ignores_stale_snapshot_for_previous_docker_id(collector_engine):
    with Session(collector_engine) as session:
        session.add(Container(
            docker_id="docker-new",
            short_id="docker-new",
            previous_docker_id="docker-old",
            name="app",
            image="app:latest",
            status="running",
            state="running",
            compose_project="test-project",
            compose_service="app",
        ))
        session.add(ContainerEvent(
            container_id="docker-new",
            container_name="app",
            event_type="recreated",
            details="Container recreated: docker-old -> docker-new",
        ))
        session.commit()

    stale = _container_data(
        started_at="2026-06-28T10:00:00Z",
        rx=1_500,
        tx=2_750,
    )
    stale["docker_id"] = "docker-old"
    stale["short_id"] = "docker-old"

    collector._apply_batch([stale])

    with Session(collector_engine) as session:
        containers = session.exec(select(Container)).all()
        events = session.exec(select(ContainerEvent)).all()

    assert len(containers) == 1
    assert containers[0].docker_id == "docker-new"
    assert containers[0].previous_docker_id == "docker-old"
    assert len(events) == 1
    assert events[0].details == "Container recreated: docker-old -> docker-new"


def test_apply_batch_persists_operational_metadata(collector_engine):
    stopped = _container_data(
        started_at="2026-06-28T10:00:00Z",
        rx=0,
        tx=0,
    )
    stopped.update({
        "status": "exited",
        "state": "exited",
        "health_status": None,
        "restart_policy": "on-failure:3",
        "exit_code": 137,
        "oom_killed": True,
        "finished_at": "2026-06-28T11:30:00Z",
        "container_error": "out of memory",
    })

    collector._apply_batch([stopped])

    with Session(collector_engine) as session:
        container = session.exec(select(Container)).one()

    assert container.restart_policy == "on-failure:3"
    assert container.exit_code == 137
    assert container.oom_killed is True
    assert container.finished_at == datetime(2026, 6, 28, 11, 30, 0)
    assert container.container_error == "out of memory"
