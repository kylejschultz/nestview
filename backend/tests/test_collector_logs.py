import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault(
    "DATABASE_PATH",
    str(Path(tempfile.gettempdir()) / "nestview-test-collector-logs.db"),
)

import pytest
from sqlmodel import Session, SQLModel, create_engine

from models import AppSetting, ContainerLog
from services import collector


class FakeContainer:
    def __init__(self, started_at: str | None):
        self.attrs = {"State": {"StartedAt": started_at}}


@pytest.fixture()
def collector_engine(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(collector, "engine", engine)
    collector._log_buffer.clear()

    with Session(engine) as session:
        session.add(AppSetting(key="log_retention_days", value="7"))
        session.commit()

    return engine


def test_parse_docker_timestamp_truncates_nanoseconds_to_microseconds():
    ts = collector._parse_docker_timestamp("2026-06-29T12:34:56.123456789Z")

    assert ts == datetime(2026, 6, 29, 12, 34, 56, 123456, tzinfo=timezone.utc)


def test_log_stream_since_resumes_after_latest_persisted_log(collector_engine):
    latest = datetime(2026, 6, 29, 12, 0, 0, 123456)
    with Session(collector_engine) as session:
        session.add(ContainerLog(
            container_id="docker-1",
            container_name="app",
            timestamp=latest,
            stream="stdout",
            message="already collected",
        ))
        session.commit()

    since = collector._log_stream_since(
        "docker-1",
        FakeContainer("2026-06-29T10:00:00Z"),
    )

    assert since == latest.replace(tzinfo=timezone.utc) + timedelta(microseconds=1)


def test_log_stream_since_considers_buffered_logs_newer_than_persisted(collector_engine):
    collector._log_buffer["docker-1"].append({
        "timestamp": "2026-06-29T12:10:00.000100+00:00",
    })

    since = collector._log_stream_since(
        "docker-1",
        FakeContainer("2026-06-29T10:00:00Z"),
    )

    assert since == datetime(2026, 6, 29, 12, 10, 0, 101, tzinfo=timezone.utc)


def test_log_stream_since_uses_started_at_for_first_collection(collector_engine):
    since = collector._log_stream_since(
        "docker-1",
        FakeContainer("2026-06-29T10:00:00.999999999Z"),
    )

    assert since == datetime(2026, 6, 29, 10, 0, 0, 999999, tzinfo=timezone.utc)
