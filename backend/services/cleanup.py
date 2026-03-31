import os
from datetime import datetime, timedelta

from sqlmodel import Session, select, delete

from backend.database import engine
from backend.models import ContainerLog, ContainerEvent

LOG_RETENTION_DAYS = int(os.getenv("LOG_RETENTION_DAYS", "7"))


def run_cleanup():
    cutoff = datetime.utcnow() - timedelta(days=LOG_RETENTION_DAYS)
    with Session(engine) as session:
        log_result = session.exec(
            delete(ContainerLog).where(ContainerLog.timestamp < cutoff)
        )
        event_result = session.exec(
            delete(ContainerEvent).where(ContainerEvent.timestamp < cutoff)
        )
        session.commit()
        deleted_logs = log_result.rowcount
        deleted_events = event_result.rowcount

    if deleted_logs or deleted_events:
        print(
            f"[cleanup] Removed {deleted_logs} logs and {deleted_events} events "
            f"older than {LOG_RETENTION_DAYS} days"
        )
