import os
from datetime import datetime, timedelta

from sqlmodel import Session, delete

from database import engine
from models import Container, ContainerLog, ContainerEvent

LOG_RETENTION_DAYS = int(os.getenv("LOG_RETENTION_DAYS", "7"))
# Exited/dead containers are removed from the DB after this many hours if
# the ghost-detection and reconciliation passes haven't already deleted them
# (e.g. standalone containers, or collector downtime).  Fractional hours are
# supported (e.g. "0.083" ≈ 5 minutes).  Set to 0 to disable.
EXITED_CONTAINER_TTL_HOURS = float(os.getenv("EXITED_CONTAINER_TTL_HOURS", "0.083"))

_TERMINAL_STATES = ("exited", "dead")


def run_cleanup():
    log_cutoff = datetime.utcnow() - timedelta(days=LOG_RETENTION_DAYS)

    with Session(engine) as session:
        log_result = session.exec(
            delete(ContainerLog).where(ContainerLog.timestamp < log_cutoff)
        )
        event_result = session.exec(
            delete(ContainerEvent).where(ContainerEvent.timestamp < log_cutoff)
        )

        # TTL-based purge of stale exited/dead container rows.  This is a
        # safety net for containers that disappeared while the collector was
        # offline and were therefore never reconciled out.
        purged_containers = 0
        if EXITED_CONTAINER_TTL_HOURS > 0:
            container_cutoff = datetime.utcnow() - timedelta(
                hours=EXITED_CONTAINER_TTL_HOURS
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
            f"older than {LOG_RETENTION_DAYS} days"
        )
    if purged_containers:
        print(
            f"[cleanup] Purged {purged_containers} stale exited/dead container records "
            f"(last_seen > {EXITED_CONTAINER_TTL_HOURS}h ago)"
        )
