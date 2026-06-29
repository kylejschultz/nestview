import os
from pathlib import Path

from sqlalchemy import event
from sqlmodel import create_engine, SQLModel, Session

# Explicit imports ensure all models are registered in SQLModel.metadata
# before create_db_and_tables() is called.
from models import AppSetting, Container, ContainerAlertSetting, ContainerEvent, ContainerLog, ContainerMetricsHistory, ContainerNetworkHistory, Operation  # noqa: F401

DB_PATH = Path(os.getenv("DATABASE_PATH", "/data/nestview.db"))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _configure_sqlite_connection(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
