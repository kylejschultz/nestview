from __future__ import annotations

import uuid
from typing import Any


def _custom_hostname(config: dict[str, Any], old_id: str) -> str | None:
    hostname = config.get("Hostname") or ""
    if not hostname:
        return None
    if hostname == old_id[:12]:
        return None
    return hostname


def _merged_labels(client, image_ref: str, old_labels: dict[str, str] | None) -> dict[str, str] | None:
    labels = dict(old_labels or {})
    try:
        image = client.images.get(image_ref)
        labels.update(image.labels or {})
        if "com.docker.compose.image" in labels:
            labels["com.docker.compose.image"] = image.id
    except Exception:
        pass
    return labels or None


def _networking_config(client, attrs: dict[str, Any], old_name: str):
    old_id = attrs["Id"]
    endpoints = {}

    for network_name, network in attrs.get("NetworkSettings", {}).get("Networks", {}).items():
        aliases = []
        seen = set()
        for alias in network.get("Aliases") or []:
            if not alias or alias in {old_id, old_id[:12]} or alias in seen:
                continue
            aliases.append(alias)
            seen.add(alias)

        if old_name not in seen:
            aliases.append(old_name)

        endpoints[network_name] = client.api.create_endpoint_config(
            aliases=aliases or None,
            links=network.get("Links"),
        )

    return client.api.create_networking_config(endpoints) if endpoints else None


def _create_kwargs(client, attrs: dict[str, Any], image_ref: str, name: str) -> dict[str, Any]:
    config = attrs["Config"]
    return {
        "image": image_ref,
        "command": config.get("Cmd"),
        "hostname": _custom_hostname(config, attrs["Id"]),
        "user": config.get("User") or None,
        "detach": True,
        "stdin_open": config.get("OpenStdin", False),
        "tty": config.get("Tty", False),
        "ports": list((config.get("ExposedPorts") or {}).keys()) or None,
        "environment": config.get("Env"),
        "volumes": list((config.get("Volumes") or {}).keys()) or None,
        "network_disabled": config.get("NetworkDisabled", False),
        "name": name,
        "entrypoint": config.get("Entrypoint"),
        "working_dir": config.get("WorkingDir") or None,
        "domainname": config.get("Domainname") or None,
        "host_config": attrs["HostConfig"],
        "labels": _merged_labels(client, image_ref, config.get("Labels")),
        "stop_signal": config.get("StopSignal"),
        "networking_config": _networking_config(client, attrs, name),
        "healthcheck": config.get("Healthcheck"),
        "stop_timeout": config.get("StopTimeout"),
        "runtime": attrs["HostConfig"].get("Runtime") or None,
    }


def recreate_container_with_current_config(client, docker_id: str, image_ref: str) -> str:
    old_container = client.containers.get(docker_id)
    old_container.reload()

    attrs = old_container.attrs
    old_name = old_container.name
    old_state = attrs.get("State", {})
    was_running = bool(old_state.get("Running"))
    was_paused = bool(old_state.get("Paused"))
    renamed_old = False
    new_container = None
    temporary_name = f"{old_name}-old-{uuid.uuid4().hex[:8]}"

    try:
        if was_paused:
            old_container.unpause()

        old_container.stop(timeout=attrs["HostConfig"].get("StopTimeout") or 10)
        old_container.rename(temporary_name)
        renamed_old = True

        new_id = client.api.create_container(
            **_create_kwargs(client, attrs, image_ref, old_name)
        )["Id"]
        new_container = client.containers.get(new_id)
        new_container.start()

        old_container.remove(force=True)
        return new_container.id
    except Exception:
        if new_container is not None:
            try:
                new_container.remove(force=True)
            except Exception:
                pass

        if renamed_old:
            try:
                old_container.rename(old_name)
            except Exception:
                pass

        if was_running or was_paused:
            try:
                old_container.start()
                if was_paused:
                    old_container.pause()
            except Exception:
                pass

        raise
