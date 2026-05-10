from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import SQLModel, Field


class AppSetting(SQLModel, table=True):
    __tablename__ = "app_setting"

    key: str = Field(primary_key=True, max_length=128)
    value: str = Field(default="")
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Container(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    docker_id: str = Field(index=True, unique=True)
    short_id: str
    name: str
    image: str
    status: str
    state: str
    restart_count: int = 0
    cpu_percent: float = 0.0
    mem_usage: int = 0
    mem_limit: int = 0
    ports: str = "[]"
    volumes: str = "[]"
    networks: str = "[]"
    compose_project: Optional[str] = None
    compose_service: Optional[str] = None
    created_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    last_seen: datetime = Field(default_factory=datetime.utcnow)
    image_digest: Optional[str] = None
    registry_digest: Optional[str] = None
    update_available: bool = False
    last_digest_check: Optional[datetime] = None
    image_size: Optional[int] = None
    last_pulled: Optional[datetime] = None
    update_alert_sent_digest: Optional[str] = None
    net_rx_bytes: Optional[int] = 0
    net_tx_bytes: Optional[int] = 0
    previous_docker_id: Optional[str] = None


class ContainerLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    container_id: str = Field(index=True)
    container_name: str
    timestamp: datetime = Field(index=True)
    stream: str = "stdout"
    message: str


class ContainerEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    container_id: str = Field(index=True)
    container_name: str
    event_type: str
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)
    details: Optional[str] = None
    alerted: bool = False


class ContainerNetworkHistory(SQLModel, table=True):
    __tablename__ = "container_network_history"

    id: Optional[int] = Field(default=None, primary_key=True)
    container_id: str = Field(index=True)
    rx_bytes: int = Field(default=0)
    tx_bytes: int = Field(default=0)
    recorded_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class ContainerMetricsHistory(SQLModel, table=True):
    __tablename__ = "container_metrics_history"

    id: Optional[int] = Field(default=None, primary_key=True)
    docker_id: str = Field(index=True)
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)
    cpu_percent: float = Field(default=0.0)
    mem_usage_bytes: int = Field(default=0)
    mem_limit_bytes: int = Field(default=0)


class ContainerAlertSetting(SQLModel, table=True):
    __tablename__ = "container_alert_setting"
    __table_args__ = (UniqueConstraint("container_name", "event_type"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    container_name: str = Field(index=True, max_length=256)
    # One of: crash, restart, oom, update_available
    event_type: str = Field(max_length=32)
    enabled: bool = Field(default=True)
