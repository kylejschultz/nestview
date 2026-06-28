import os
import tempfile
from datetime import datetime
from pathlib import Path

os.environ.setdefault(
    "DATABASE_PATH",
    str(Path(tempfile.gettempdir()) / "nestview-test-analytics.db"),
)

import pytest
from sqlmodel import Session, SQLModel, create_engine

from models import AppSetting, Container
from services import analytics


class _FakeResponse:
    def raise_for_status(self):
        return None


class _FakeAsyncClient:
    posts = 0

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        self.__class__.posts += 1
        return _FakeResponse()


@pytest.fixture()
def analytics_engine(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(analytics, "engine", engine)
    monkeypatch.setattr(analytics.httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr(analytics, "_last_ping_date", None)
    _FakeAsyncClient.posts = 0

    with Session(engine) as session:
        session.add(AppSetting(key="analytics_enabled", value="true"))
        session.add(AppSetting(key="install_id", value="install-1"))
        session.add(AppSetting(key="analytics_last_ping_date", value=""))
        session.add(Container(
            docker_id="docker-1",
            short_id="docker-1",
            name="app",
            image="app:latest",
            status="running",
            state="running",
        ))
        session.commit()

    return engine


@pytest.mark.asyncio
async def test_analytics_ping_persists_daily_guard(analytics_engine):
    await analytics.run_analytics_ping()
    await analytics.run_analytics_ping()

    today = datetime.utcnow().strftime("%Y-%m-%d")

    with Session(analytics_engine) as session:
        row = session.get(AppSetting, "analytics_last_ping_date")

    assert _FakeAsyncClient.posts == 1
    assert row is not None
    assert row.value == today


@pytest.mark.asyncio
async def test_analytics_ping_skips_when_date_already_persisted(analytics_engine):
    today = datetime.utcnow().strftime("%Y-%m-%d")
    with Session(analytics_engine) as session:
        row = session.get(AppSetting, "analytics_last_ping_date")
        assert row is not None
        row.value = today
        session.add(row)
        session.commit()

    await analytics.run_analytics_ping()

    assert _FakeAsyncClient.posts == 0
