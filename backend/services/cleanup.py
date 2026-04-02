import os
from datetime import datetime, timedelta

from sqlmodel import Session, delete

from database import engine
from models import Container, ContainerLog, ContainerEvent
from services.app_settings import get_setting

# Env-var bootstrap defaults; DB values (set via Settings UI) take precedence
# at runtime once the service has started for the first time.
_DEFAULT_LOG_RETENTION_DAYS = int(os.getenv("LOG_RETENTION_DAYS", "7"))
_DEFAULT_EXITED_CONTAINER_TTL_HOURS = float(os.getenv("EXITED_CONTAINER_TTL_HOURS", "0.083"))

_TERMINAL_STATES = ("exited", "dead")


def run_cleanup():
    with Session(engine) as session:
        retention_str = get_setting(session, "log_retention_days")
        log_retention = int(retention_str) if retention_str else _DEFAULT_LOG_RETENTION_DAYS
        log_cutoff = datetime.utcnow() - timedelta(days=log_retention)
        log_result = session.exec(
            delete(ContainerLog).where(ContainerLog.timestamp < log_cutoff)
        )
        event_result = session.exec(
            delete(ContainerEvent).where(ContainerEvent.timestamp < log_cutoff)
        )

        ttl_str = get_setting(session, "exited_container_ttl_hours")
        exited_ttl = float(ttl_str) if ttl_str else _DEFAULT_EXITED_CONTAINER_TTL_HOURS

        # TTL-based purge of stale exited/dead container rows.  This is a
        # safety net for containers that disappeared while the collector was
        # offline and were therefore never reconciled out.
        purged_containers = 0
        if exited_ttl > 0:
            container_cutoff = datetime.utcnow() - timedelta(
                hours=exited_ttl
            )
            c_result = session.exec(
                delete(Container).where(
                    Container.state.in_(_TERMINAL_STATES),
                    Container.last_seen < container_cutoff,
                )
            )
            purged_containers = c_result.rowcount

        session.commit()
        deleted_logs = log_result.rowcount
        deleted_events = event_result.rowcount

    if deleted_logs or deleted_events:
        print(
            f"[cleanup] Removed {deleted_logs} logs and {deleted_events} events "
            f"older than {log_retention} days"
        )
    if purged_containers:
        print(
            f"[cleanup] Purged {purged_containers} stale exited/dead container records "
            f"(last_seen > {exited_ttl}h ago)"
        )
