"""
collector.py — Docker socket collector running inside the backend process.

Replaces the standalone collector container. Started as daemon threads
from the FastAPI lifespan function.
"""

import asyncio
import json
import logging
import re
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

import docker
from sqlalchemy import update as sa_update
from sqlmodel import Session, delete, select

from database import engine
from models import Container, ContainerAlertSetting, ContainerEvent, ContainerLog, ContainerMetricsHistory, ContainerNetworkHistory
from services import discord
from services.app_settings import get_setting

logger = logging.getLogger(__name__)

POLL_INTERVAL = 10       # overridden by env var at startup
LOG_BATCH_INTERVAL = 5   # overridden by env var at startup

client = docker.from_env()

# container_id → active Thread
_log_threads: dict[str, threading.Thread] = {}

# container_id → list of log dicts (flushed periodically)
_log_buffer: dict[str, list] = defaultdict(list)
_log_lock = threading.Lock()

# container_id → last known started_at string (used to detect restarts)
_container_started_at: dict[str, Optional[str]] = {}


def _safe_name(name: str) -> str:
    """Strip control characters from container names before printing."""
    return re.sub(r"[\x00-\x1f\x7f]", "?", name)


# ── Stats helpers ──────────────────────────────────────────────────────────────


def _cpu_percent(stats: dict) -> float:
    try:
        cpu_delta = (
            stats["cpu_stats"]["cpu_usage"]["total_usage"]
            - stats["precpu_stats"]["cpu_usage"]["total_usage"]
        )
        system_delta = stats["cpu_stats"].get("system_cpu_usage", 0) - stats[
            "precpu_stats"
        ].get("system_cpu_usage", 0)
        num_cpus = stats["cpu_stats"].get("online_cpus") or len(
            stats["cpu_stats"]["cpu_usage"].get("percpu_usage", [1])
        )
        if system_delta > 0:
            return round((cpu_delta / system_delta) * num_cpus * 100.0, 2)
    except (KeyError, ZeroDivisionError):
        pass
    return 0.0


def _mem_bytes(stats: dict) -> tuple[int, int]:
    """Return (usage_bytes, limit_bytes) with cache subtracted."""
    mem = stats.get("memory_stats", {})
    usage = mem.get("usage", 0)
    cache = mem.get("stats", {}).get("cache", 0)
    limit = mem.get("limit", 0)
    return max(0, usage - cache), limit


def _net_bytes(stats: dict) -> tuple[int, int]:
    """Return (rx_bytes, tx_bytes) summed across all network interfaces."""
    rx, tx = 0, 0
    for iface in stats.get("networks", {}).values():
        rx += iface.get("rx_bytes", 0)
        tx += iface.get("tx_bytes", 0)
    return rx, tx


# ── Container data collection ──────────────────────────────────────────────────


def _collect_one(container) -> Optional[dict]:
    try:
        container.reload()
        raw_stats = container.stats(stream=False)

        cpu = _cpu_percent(raw_stats)
        mem_usage, mem_limit = _mem_bytes(raw_stats)
        net_rx, net_tx = _net_bytes(raw_stats)

        labels = container.labels or {}
        ports_map = container.ports or {}
        ports = [
            f"{h[0]['HostPort']}:{cport.split('/')[0]}"
            for cport, h in ports_map.items()
            if h
        ]
        mounts = container.attrs.get("Mounts", [])
        volumes = [
            f"{m.get('Source', '?')}:{m.get('Destination', '?')}" for m in mounts
        ]
        networks = list(
            container.attrs.get("NetworkSettings", {}).get("Networks", {}).keys()
        )

        image_tags = container.image.tags
        image = (
            image_tags[0]
            if image_tags
            else container.attrs.get("Config", {}).get("Image", "unknown")
        )

        return {
            "docker_id": container.id,
            "short_id": container.short_id,
            "name": container.name.lstrip("/"),
            "image": image,
            "status": container.status,
            "state": container.attrs["State"]["Status"],
            "restart_count": container.attrs.get("RestartCount", 0),
            "cpu_percent": cpu,
            "mem_usage": mem_usage,
            "mem_limit": mem_limit,
            "ports": json.dumps(ports),
            "volumes": json.dumps(volumes),
            "networks": json.dumps(networks),
            "compose_project": labels.get("com.docker.compose.project"),
            "compose_service": labels.get("com.docker.compose.service"),
            "created_at": container.attrs.get("Created"),
            "started_at": container.attrs.get("State", {}).get("StartedAt"),
            "net_rx_bytes": net_rx,
            "net_tx_bytes": net_tx,
        }
    except Exception as exc:
        name = _safe_name(getattr(container, "name", "?"))
        logger.error("Error collecting stats for %s: %s", name, type(exc).__name__)
        return None


# ── Batch reconciliation ───────────────────────────────────────────────────────


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        normalized = s.replace("Z", "+00:00") if s.endswith("Z") else s
        dt = datetime.fromisoformat(normalized)
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return None


def _apply_batch(containers_data: list[dict]) -> None:
    seen_ids = set()
    protected_ids: set[str] = set()
    with Session(engine) as session:
        for c in containers_data:
            docker_id = c["docker_id"]
            seen_ids.add(docker_id)

            # Restart detection: if started_at changed, the container has restarted
            # since the last poll — clear its network history so the chart starts fresh.
            new_started = c["started_at"]
            prev_started = _container_started_at.get(docker_id)
            if prev_started is not None and prev_started != new_started:
                session.exec(
                    delete(ContainerNetworkHistory).where(
                        ContainerNetworkHistory.container_id == docker_id
                    )
                )
                logger.info("Cleared network history for %s (restart detected)", c['name'])
            _container_started_at[docker_id] = new_started

            existing = session.exec(
                select(Container).where(Container.docker_id == docker_id)
            ).first()

            if existing:
                existing.name = c["name"]
                existing.image = c["image"]
                existing.status = c["status"]
                existing.state = c["state"]
                existing.restart_count = c["restart_count"]
                existing.cpu_percent = c["cpu_percent"]
                existing.mem_usage = c["mem_usage"]
                existing.mem_limit = c["mem_limit"]
                existing.ports = c["ports"]
                existing.volumes = c["volumes"]
                existing.networks = c["networks"]
                existing.compose_project = c["compose_project"]
                existing.compose_service = c["compose_service"]
                existing.started_at = _parse_dt(c["started_at"])
                existing.net_rx_bytes = c["net_rx_bytes"]
                existing.net_tx_bytes = c["net_tx_bytes"]
                existing.last_seen = datetime.utcnow()
                session.add(existing)
            else:
                # Recreation detection: look for an existing row with the same
                # name + compose_project but a different docker_id. Both fields
                # must be non-empty for the match to be unambiguous.
                new_project = c["compose_project"]
                reassociated = False

                if new_project:
                    candidates = session.exec(
                        select(Container).where(
                            Container.name == c["name"],
                            Container.compose_project == new_project,
                            Container.docker_id != docker_id,
                        )
                    ).all()

                    if len(candidates) == 1:
                        old = candidates[0]
                        old_docker_id = old.docker_id
                        try:
                            sp = session.begin_nested()

                            # Re-associate all history tables to the new docker_id
                            session.exec(
                                sa_update(ContainerNetworkHistory)
                                .where(ContainerNetworkHistory.container_id == old_docker_id)
                                .values(container_id=docker_id)
                            )
                            session.exec(
                                sa_update(ContainerMetricsHistory)
                                .where(ContainerMetricsHistory.docker_id == old_docker_id)
                                .values(docker_id=docker_id)
                            )
                            session.exec(
                                sa_update(ContainerLog)
                                .where(ContainerLog.container_id == old_docker_id)
                                .values(container_id=docker_id)
                            )
                            session.exec(
                                sa_update(ContainerEvent)
                                .where(ContainerEvent.container_id == old_docker_id)
                                .values(container_id=docker_id)
                            )

                            # Update the existing Container row in-place
                            old.docker_id = docker_id
                            old.short_id = c["short_id"]
                            old.previous_docker_id = old_docker_id
                            old.image = c["image"]
                            old.status = c["status"]
                            old.state = c["state"]
                            old.restart_count = c["restart_count"]
                            old.cpu_percent = c["cpu_percent"]
                            old.mem_usage = c["mem_usage"]
                            old.mem_limit = c["mem_limit"]
                            old.ports = c["ports"]
                            old.volumes = c["volumes"]
                            old.networks = c["networks"]
                            old.compose_service = c["compose_service"]
                            old.started_at = _parse_dt(c["started_at"])
                            old.net_rx_bytes = c["net_rx_bytes"]
                            old.net_tx_bytes = c["net_tx_bytes"]
                            old.last_seen = datetime.utcnow()
                            session.add(old)

                            # Record the recreation as an event
                            session.add(ContainerEvent(
                                container_id=docker_id,
                                container_name=c["name"],
                                event_type="recreated",
                                details=f"Container recreated: {old_docker_id[:12]} → {docker_id[:12]}",
                                timestamp=datetime.utcnow(),
                                alerted=False,
                            ))

                            sp.commit()
                            reassociated = True
                            protected_ids.add(old_docker_id)
                            logger.info(
                                "Re-associated container %s (%s → %s)",
                                c["name"], old_docker_id[:12], docker_id[:12],
                            )
                        except Exception as exc:
                            sp.rollback()
                            logger.warning(
                                "Re-association failed for %s, inserting as new: %s",
                                c["name"], exc,
                            )

                if not reassociated:
                    new_container = Container(
                        docker_id=docker_id,
                        short_id=c["short_id"],
                        name=c["name"],
                        image=c["image"],
                        status=c["status"],
                        state=c["state"],
                        restart_count=c["restart_count"],
                        cpu_percent=c["cpu_percent"],
                        mem_usage=c["mem_usage"],
                        mem_limit=c["mem_limit"],
                        ports=c["ports"],
                        volumes=c["volumes"],
                        networks=c["networks"],
                        compose_project=c["compose_project"],
                        compose_service=c["compose_service"],
                        created_at=_parse_dt(c["created_at"]),
                        started_at=_parse_dt(c["started_at"]),
                        net_rx_bytes=c["net_rx_bytes"],
                        net_tx_bytes=c["net_tx_bytes"],
                        last_seen=datetime.utcnow(),
                    )
                    session.add(new_container)

        # Reconcile: purge any DB row whose docker_id was not in this snapshot.
        # Guard: skip when batch is empty to avoid accidentally wiping the table.
        # Also exclude re-associated rows whose old docker_id is no longer reported
        # by Docker but whose row has already been updated in-place.
        if seen_ids:
            exclude_ids = seen_ids | protected_ids if protected_ids else seen_ids
            session.exec(
                delete(Container).where(Container.docker_id.notin_(exclude_ids))
            )

        # Ghost-detection pass: remove exited/dead rows superseded by a live
        # container with the same name and compose_project.
        _TERMINAL = {"exited", "dead"}
        _LIVE = {"running", "restarting", "paused"}

        all_rows = session.exec(select(Container)).all()
        live_keys: set[tuple] = {
            (r.name, r.compose_project) for r in all_rows if r.state in _LIVE
        }
        ghost_ids = [
            r.id
            for r in all_rows
            if r.state in _TERMINAL and (r.name, r.compose_project) in live_keys
        ]
        for gid in ghost_ids:
            ghost = session.get(Container, gid)
            if ghost:
                session.delete(ghost)

        session.commit()


def _write_network_history(containers_data: list[dict]) -> None:
    """Write one rx/tx snapshot per running container, then prune old records.

    The retention window is read from the DB on each call so that changes made
    in Settings take effect without a container restart.
    """
    now = datetime.utcnow()

    with Session(engine) as session:
        retention_str = get_setting(session, "network_history_retention_hours")
        retention_hours = float(retention_str) if retention_str else 6.0
        cutoff = now - timedelta(hours=retention_hours)

        for c in containers_data:
            if c.get("state") != "running":
                continue

            docker_id = c["docker_id"]
            session.add(ContainerNetworkHistory(
                container_id=docker_id,
                rx_bytes=c["net_rx_bytes"],
                tx_bytes=c["net_tx_bytes"],
                recorded_at=now,
            ))

            # Prune records outside the rolling retention window for this container
            session.exec(
                delete(ContainerNetworkHistory).where(
                    ContainerNetworkHistory.container_id == docker_id,
                    ContainerNetworkHistory.recorded_at < cutoff,
                )
            )

        session.commit()


def _write_metrics_history(containers_data: list[dict]) -> None:
    """Write one CPU/memory snapshot per running container, pruning old records.

    Shares the same retention window as network history.
    """
    now = datetime.utcnow()

    with Session(engine) as session:
        retention_str = get_setting(session, "network_history_retention_hours")
        retention_hours = float(retention_str) if retention_str else 6.0
        cutoff = now - timedelta(hours=retention_hours)

        for c in containers_data:
            if c.get("state") != "running":
                continue

            docker_id = c["docker_id"]
            session.add(ContainerMetricsHistory(
                docker_id=docker_id,
                timestamp=now,
                cpu_percent=c["cpu_percent"],
                mem_usage_bytes=c["mem_usage"],
                mem_limit_bytes=c["mem_limit"],
            ))

            session.exec(
                delete(ContainerMetricsHistory).where(
                    ContainerMetricsHistory.docker_id == docker_id,
                    ContainerMetricsHistory.timestamp < cutoff,
                )
            )

        session.commit()


# ── Log streaming ──────────────────────────────────────────────────────────────


def _stream_logs(container_id: str, container_name: str) -> None:
    """Background thread: stream logs from one container and buffer them."""
    try:
        local_client = docker.from_env()
        container = local_client.containers.get(container_id)
        since = datetime.now(timezone.utc)

        log_stream = container.logs(
            stream=True,
            follow=True,
            since=since,
            timestamps=True,
            stdout=True,
            stderr=True,
        )

        for raw in log_stream:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            parts = line.split(" ", 1)
            if len(parts) == 2:
                ts_raw, message = parts
                try:
                    ts = datetime.fromisoformat(
                        ts_raw[:19].replace("T", "T")
                    ).replace(tzinfo=timezone.utc)
                except Exception:
                    ts = datetime.now(timezone.utc)
                    message = line
            else:
                ts = datetime.now(timezone.utc)
                message = line

            with _log_lock:
                _log_buffer[container_id].append(
                    {
                        "container_id": container_id,
                        "container_name": container_name,
                        "timestamp": ts.isoformat(),
                        "stream": "stdout",
                        "message": message,
                    }
                )
    except Exception as exc:
        logger.warning("Log stream ended for %s: %s", _safe_name(container_name), type(exc).__name__)


def _flush_logs() -> None:
    with _log_lock:
        all_logs = [log for logs in _log_buffer.values() for log in logs]
        _log_buffer.clear()
    if not all_logs:
        return
    with Session(engine) as session:
        for entry in all_logs:
            session.add(ContainerLog(
                container_id=entry["container_id"],
                container_name=entry["container_name"],
                timestamp=datetime.fromisoformat(entry["timestamp"]),
                stream=entry["stream"],
                message=entry["message"],
            ))
        session.commit()


# ── Event watcher ──────────────────────────────────────────────────────────────

_ALERT_EVENT_TYPES = {"crash", "oom", "restart"}
_SETTING_KEY: dict[str, str] = {
    "crash": "crash",
    "die": "crash",
    "oom": "oom",
    "restart": "restart",
}
_GLOBAL_SENTINEL = "__global__"


def _alert_suppressed(container_name: str, event_type: str, session: Session) -> bool:
    setting_key = _SETTING_KEY.get(event_type)
    if not setting_key:
        return False

    per_container = session.exec(
        select(ContainerAlertSetting)
        .where(ContainerAlertSetting.container_name == container_name)
        .where(ContainerAlertSetting.event_type == setting_key)
    ).first()
    if per_container is not None:
        return not per_container.enabled

    global_default = session.exec(
        select(ContainerAlertSetting)
        .where(ContainerAlertSetting.container_name == _GLOBAL_SENTINEL)
        .where(ContainerAlertSetting.event_type == setting_key)
    ).first()
    if global_default is not None:
        return not global_default.enabled

    return False


def _watch_events() -> None:
    """Background thread: watch Docker event stream and write directly to DB."""
    TRACKED = {"start", "stop", "die", "kill", "restart", "oom"}
    while True:
        try:
            for event in client.events(decode=True):
                if event.get("Type") != "container":
                    continue
                action = event.get("Action", "")
                if action not in TRACKED:
                    continue

                actor = event.get("Actor", {})
                container_id = actor.get("ID", "")
                attrs = actor.get("Attributes", {})
                container_name = attrs.get("name", "unknown").lstrip("/")
                exit_code = attrs.get("exitCode", "")

                event_type = action
                if action == "die" and exit_code and exit_code != "0":
                    event_type = "crash"

                details = f"Exit code: {exit_code}" if exit_code else None

                ts = datetime.fromtimestamp(
                    event.get("time", time.time()), tz=timezone.utc
                ).replace(tzinfo=None)

                try:
                    with Session(engine) as session:
                        db_event = ContainerEvent(
                            container_id=container_id,
                            container_name=container_name,
                            event_type=event_type,
                            details=details,
                            timestamp=ts,
                            alerted=False,
                        )
                        session.add(db_event)

                        session.commit()
                        session.refresh(db_event)

                        if event_type in _ALERT_EVENT_TYPES and not _alert_suppressed(
                            container_name, event_type, session
                        ):
                            webhook_url = get_setting(session, "discord_webhook_url") or ""
                            if webhook_url:
                                try:
                                    alerted = asyncio.run(discord.send_alert(
                                        webhook_url=webhook_url,
                                        container_name=container_name,
                                        event_type=event_type,
                                        details=details,
                                        timestamp=ts,
                                    ))
                                    if alerted:
                                        db_event.alerted = True
                                        session.add(db_event)
                                        session.commit()
                                except Exception as exc:
                                    logger.error("Discord alert failed: %s", exc)
                except Exception as exc:
                    logger.error("Event write failed: %s", exc)
        except Exception as exc:
            logger.warning("Event watcher error (retrying): %s", exc)
            time.sleep(5)


# ── Main stats loop ────────────────────────────────────────────────────────────


def _stats_loop() -> None:
    """Background thread: poll Docker stats and reconcile DB."""
    last_flush = time.time()

    while True:
        try:
            containers = client.containers.list(all=True)
            container_data = []

            for container in containers:
                # Ensure a log-stream thread is running for every live container
                if container.status == "running":
                    t = _log_threads.get(container.id)
                    if t is None or not t.is_alive():
                        t = threading.Thread(
                            target=_stream_logs,
                            args=(container.id, container.name.lstrip("/")),
                            daemon=True,
                        )
                        t.start()
                        _log_threads[container.id] = t

                data = _collect_one(container)
                if data:
                    container_data.append(data)

            # Prune dead log threads
            for cid in list(_log_threads):
                if not _log_threads[cid].is_alive():
                    del _log_threads[cid]

            if container_data:
                _apply_batch(container_data)
                _write_network_history(container_data)
                _write_metrics_history(container_data)

            if time.time() - last_flush >= LOG_BATCH_INTERVAL:
                _flush_logs()
                last_flush = time.time()

        except Exception as exc:
            logger.error("Main loop error: %s", exc)

        time.sleep(POLL_INTERVAL)


# ── Entry point ────────────────────────────────────────────────────────────────


def start_collector(poll_interval: int = 10, log_batch_interval: int = 5) -> None:
    global POLL_INTERVAL, LOG_BATCH_INTERVAL
    POLL_INTERVAL = poll_interval
    LOG_BATCH_INTERVAL = log_batch_interval

    threading.Thread(target=_watch_events, daemon=True, name="collector-events").start()
    threading.Thread(target=_stats_loop, daemon=True, name="collector-stats").start()
    logger.info("Started — poll=%ds log_flush=%ds", POLL_INTERVAL, LOG_BATCH_INTERVAL)
