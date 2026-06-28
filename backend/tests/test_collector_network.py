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

from models import AppSetting, Container, ContainerNetworkHistory
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
        "name": "app",
        "state": "running",
        "started_at": started_at,
        "net_rx_bytes": rx,
        "net_tx_bytes": tx,
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
