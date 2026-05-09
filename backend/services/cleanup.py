import logging
import os
from datetime import datetime, timedelta

from sqlmodel import Session, delete

from database import engine
from models import Container, ContainerLog, ContainerEvent, ContainerMetricsHistory, ContainerNetworkHistory
from services.app_settings import get_setting

logger = logging.getLogger(__name__)

# Env-var bootstrap defaults; DB values (set via Settings UI) take precedence
# at runtime once the service has started for the first time.
_DEFAULT_LOG_RETENTION_DAYS = int(os.getenv("LOG_RETENTION_DAYS") or "7")
_DEFAULT_EXITED_CONTAINER_TTL_SECONDS = 300

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

        ttl_str = get_setting(session, "exited_container_ttl_seconds")
        exited_ttl = int(ttl_str) if ttl_str else _DEFAULT_EXITED_CONTAINER_TTL_SECONDS

        # TTL-based purge of stale exited/dead container rows.  This is a
        # safety net for containers that disappeared while the collector was
        # offline and were therefore never reconciled out.
        purged_containers = 0
        if exited_ttl > 0:
            container_cutoff = datetime.utcnow() - timedelta(
                seconds=exited_ttl
            )
            c_result = session.exec(
                delete(Container).where(
                    Container.state.in_(_TERMINAL_STATES),
                    Container.last_seen < container_cutoff,
                )
            )
            purged_containers = c_result.rowcount

        retention_history_str = get_setting(session, "network_history_retention_hours")
        history_retention_hours = float(retention_history_str) if retention_history_str else 6.0
        history_cutoff = datetime.utcnow() - timedelta(hours=history_retention_hours)
        network_history_result = session.exec(
            delete(ContainerNetworkHistory).where(
                ContainerNetworkHistory.recorded_at < history_cutoff
            )
        )
        metrics_history_result = session.exec(
            delete(ContainerMetricsHistory).where(
                ContainerMetricsHistory.timestamp < history_cutoff
            )
        )

        session.commit()
        deleted_logs = log_result.rowcount
        deleted_events = event_result.rowcount
        deleted_network_history = network_history_result.rowcount
        deleted_metrics_history = metrics_history_result.rowcount

    if deleted_logs or deleted_events:
        logger.info(
            "Removed %d logs and %d events older than %d days",
            deleted_logs, deleted_events, log_retention,
        )
    if purged_containers:
        logger.info(
            "Purged %d stale exited/dead container records (last_seen > %ds ago)",
            purged_containers, exited_ttl,
        )
    if deleted_network_history or deleted_metrics_history:
        logger.info(
            "Pruned %d network history and %d metrics history rows older than %.1f hours",
            deleted_network_history, deleted_metrics_history, history_retention_hours,
        )
