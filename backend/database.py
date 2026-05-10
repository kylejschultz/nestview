import os
from pathlib import Path

from sqlmodel import create_engine, SQLModel, Session

# Explicit imports ensure all models are registered in SQLModel.metadata
# before create_db_and_tables() is called.
from models import AppSetting, Container, ContainerAlertSetting, ContainerEvent, ContainerLog, ContainerMetricsHistory, ContainerNetworkHistory  # noqa: F401

DB_PATH = Path(os.getenv("DATABASE_PATH", "/data/nestview.db"))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
