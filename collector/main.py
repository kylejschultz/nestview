"""
Nestview Collector — Docker socket autodiscovery agent.

Runs as a sidecar container with read-only access to /var/run/docker.sock.
Polls container stats, streams logs, and watches Docker events, posting
everything to the Nestview backend via HTTP.
"""

import json
import os
import re
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional


def _safe_name(name: str) -> str:
    """Strip control characters from container names before printing."""
    return re.sub(r"[\x00-\x1f\x7f]", "?", name)

import docker
import requests

BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000").rstrip("/")
COLLECTOR_KEY = os.getenv("NESTVIEW_COLLECTOR_KEY", "")
POLL_INTERVAL = max(1, int(os.getenv("POLL_INTERVAL", "10")))
LOG_BATCH_INTERVAL = max(1, int(os.getenv("LOG_BATCH_INTERVAL", "5")))

_headers = {"X-Collector-Key": COLLECTOR_KEY} if COLLECTOR_KEY else {}

client = docker.from_env()

# container_id → active Thread
_log_threads: dict[str, threading.Thread] = {}

# container_id → list of log dicts (flushed periodically)
_log_buffer: dict[str, list] = defaultdict(list)
_log_lock = threading.Lock()


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


# ── Container data collection ──────────────────────────────────────────────────


def _collect_one(container) -> Optional[dict]:
    try:
        container.reload()
        raw_stats = container.stats(stream=False)

        cpu = _cpu_percent(raw_stats)
        mem_usage, mem_limit = _mem_bytes(raw_stats)

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
        }
    except Exception as exc:
        name = _safe_name(getattr(container, "name", "?"))
        print(f"[collector] Error collecting stats for {name}: {type(exc).__name__}")
        return None


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
                    # Truncate sub-second precision; fromisoformat handles the rest
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
        print(f"[collector] Log stream ended for {_safe_name(container_name)}: {type(exc).__name__}")


def _flush_logs() -> None:
    with _log_lock:
        all_logs = [log for logs in _log_buffer.values() for log in logs]
        _log_buffer.clear()

    if not all_logs:
        return
    try:
        requests.post(
            f"{BACKEND_URL}/api/collector/logs",
            json={"logs": all_logs},
            headers=_headers,
            timeout=10,
        )
    except Exception as exc:
        print(f"[collector] Log flush failed: {exc}")


# ── Event watcher ──────────────────────────────────────────────────────────────


def _watch_events() -> None:
    """Background thread: watch Docker event stream and report to backend."""
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
                ).isoformat()

                try:
                    requests.post(
                        f"{BACKEND_URL}/api/collector/events",
                        json={
                            "container_id": container_id,
                            "container_name": container_name,
                            "event_type": event_type,
                            "details": details,
                            "timestamp": ts,
                        },
                        headers=_headers,
                        timeout=5,
                    )
                except Exception as exc:
                    print(f"[collector] Event post failed: {exc}")
        except Exception as exc:
            print(f"[collector] Event watcher error (retrying): {exc}")
            time.sleep(5)


# ── Main loop ──────────────────────────────────────────────────────────────────


def _wait_for_backend() -> None:
    print(f"[collector] Waiting for backend at {BACKEND_URL} ...")
    while True:
        try:
            r = requests.get(f"{BACKEND_URL}/api/health", timeout=5)
            if r.status_code == 200:
                print("[collector] Backend is up.")
                return
        except Exception:
            pass
        time.sleep(3)


def main() -> None:
    print(
        f"[collector] Starting — backend={BACKEND_URL} "
        f"poll={POLL_INTERVAL}s log_flush={LOG_BATCH_INTERVAL}s"
    )
    _wait_for_backend()

    event_thread = threading.Thread(target=_watch_events, daemon=True)
    event_thread.start()

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
                try:
                    requests.post(
                        f"{BACKEND_URL}/api/containers/batch",
                        json={"containers": container_data},
                        headers=_headers,
                        timeout=15,
                    )
                except Exception as exc:
                    print(f"[collector] Container batch post failed: {exc}")

            if time.time() - last_flush >= LOG_BATCH_INTERVAL:
                _flush_logs()
                last_flush = time.time()

        except Exception as exc:
            print(f"[collector] Main loop error: {exc}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
