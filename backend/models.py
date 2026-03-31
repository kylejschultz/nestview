from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field


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
