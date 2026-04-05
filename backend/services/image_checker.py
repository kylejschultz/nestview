"""
image_checker.py — Fetch registry digests and compare against local image digests.

Supports Docker Hub (docker.io) and GHCR (ghcr.io).
Called by APScheduler on a daily cron (default 03:00) and by the admin trigger endpoint.
"""

import asyncio
import logging
from datetime import datetime
from typing import Optional, Tuple

import docker
import requests
from sqlmodel import Session, select

from database import engine
from models import Container, ContainerAlertSetting
from services import discord
from services.app_settings import get_setting

logger = logging.getLogger(__name__)

_SELF_IMAGES_PREFIX = "ghcr.io/kylejschultz/nestview-"


# ---------------------------------------------------------------------------
# Image reference parsing
# ---------------------------------------------------------------------------

def _parse_image_ref(image: str) -> Tuple[str, str, str, str]:
    """
    Parse a Docker image reference into (registry, namespace, repo, tag).

    Handles:
      nginx                         → docker.io, library, nginx, latest
      nginx:1.25                    → docker.io, library, nginx, 1.25
      library/nginx:1.25            → docker.io, library, nginx, 1.25
      myuser/myrepo:tag             → docker.io, myuser, myrepo, tag
      docker.io/library/nginx:latest → docker.io, library, nginx, latest
      ghcr.io/owner/repo:tag        → ghcr.io, owner, repo, tag
    """
    # Strip digest suffix if present (e.g. "image@sha256:...")
    if "@" in image:
        image = image.split("@")[0]

    # Split tag
    tag = "latest"
    if ":" in image.split("/")[-1]:
        image, tag = image.rsplit(":", 1)

    parts = image.split("/")

    # Detect registry: a part containing a dot or colon is a registry host
    if len(parts) >= 2 and ("." in parts[0] or ":" in parts[0]):
        registry = parts[0]
        rest = parts[1:]
    else:
        registry = "docker.io"
        rest = parts

    if len(rest) == 1:
        namespace = "library"
        repo = rest[0]
    else:
        namespace = rest[0]
        repo = "/".join(rest[1:])

    return registry, namespace, repo, tag


# ---------------------------------------------------------------------------
# Registry digest fetchers
# ---------------------------------------------------------------------------

def _fetch_dockerhub_digest(namespace: str, repo: str, tag: str) -> Optional[str]:
    url = f"https://hub.docker.com/v2/repositories/{namespace}/{repo}/tags/{tag}"
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    images = data.get("images", [])
    if images:
        return images[0].get("digest")
    return None


def _fetch_ghcr_digest(namespace: str, repo: str, tag: str) -> Optional[str]:
    url = f"https://ghcr.io/v2/{namespace}/{repo}/manifests/{tag}"
    headers = {"Accept": "application/vnd.docker.distribution.manifest.v2+json"}
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    digest = resp.headers.get("Docker-Content-Digest")
    return digest


def _fetch_registry_digest(registry: str, namespace: str, repo: str, tag: str) -> Optional[str]:
    if registry == "docker.io":
        return _fetch_dockerhub_digest(namespace, repo, tag)
    if registry == "ghcr.io":
        return _fetch_ghcr_digest(namespace, repo, tag)
    logger.debug("image_checker: unsupported registry %r — skipping", registry)
    return None


# ---------------------------------------------------------------------------
# Local image attribute helpers
# ---------------------------------------------------------------------------

def _get_local_image_attrs(image_ref: str) -> Tuple[Optional[str], Optional[int], Optional[datetime]]:
    """
    Return (local_digest, image_size_bytes, last_pulled_utc) from the Docker daemon.
    Returns (None, None, None) if the image is not found locally.
    """
    try:
        client = docker.from_env()
        img = client.images.get(image_ref)
        local_digest: Optional[str] = img.id
        image_size: Optional[int] = img.attrs.get("Size")

        last_pulled: Optional[datetime] = None
        raw_time = img.attrs.get("Metadata", {}).get("LastTagTime")
        if raw_time and raw_time != "0001-01-01T00:00:00Z":
            try:
                normalized = raw_time.replace("Z", "+00:00")
                from datetime import timezone
                dt = datetime.fromisoformat(normalized)
                last_pulled = dt.astimezone(timezone.utc).replace(tzinfo=None)
            except Exception:
                pass

        return local_digest, image_size, last_pulled
    except docker.errors.ImageNotFound:
        logger.warning("image_checker: image %r not found locally", image_ref)
        return None, None, None
    except Exception as exc:
        logger.warning("image_checker: could not inspect local image %r: %s", image_ref, exc)
        return None, None, None


# ---------------------------------------------------------------------------
# Main job
# ---------------------------------------------------------------------------

def run_image_check() -> None:
    """
    Iterate all running containers in the DB, fetch registry digests, and
    update image_digest, registry_digest, update_available, last_digest_check,
    image_size, and last_pulled on each Container row.
    """
    logger.info("image_checker: starting digest check run")

    with Session(engine) as session:
        containers = session.exec(
            select(Container).where(Container.state == "running")
        ).all()

        for container in containers:
            try:
                _check_container(session, container)
            except Exception as exc:
                logger.warning(
                    "image_checker: unhandled error for container %r: %s",
                    container.name,
                    exc,
                )

        session.commit()

    logger.info("image_checker: digest check run complete")


def _update_alert_suppressed(container_name: str, session: Session) -> bool:
    """Return True if the user has disabled update_available alerts for this container."""
    setting = session.exec(
        select(ContainerAlertSetting)
        .where(ContainerAlertSetting.container_name == container_name)
        .where(ContainerAlertSetting.event_type == "update_available")
    ).first()
    return setting is not None and not setting.enabled


def _maybe_send_update_alert(session: Session, container: Container) -> None:
    if _update_alert_suppressed(container.name, session):
        return

    webhook_url = get_setting(session, "discord_webhook_url") or ""
    if not webhook_url:
        return

    try:
        sent = asyncio.run(discord.send_alert(
            webhook_url=webhook_url,
            container_name=container.name,
            event_type="update_available",
            details=f"Image: {container.image}",
        ))
    except Exception as exc:
        logger.warning("image_checker: discord alert failed for %r: %s", container.name, type(exc).__name__)
        sent = False

    if sent:
        container.update_alert_sent_digest = container.registry_digest
        logger.info("image_checker: update alert sent for %r", container.name)


def _check_container(session: Session, container: Container) -> None:
    image_ref = container.image

    if image_ref.startswith(_SELF_IMAGES_PREFIX):
        logger.debug("image_checker: skipping self-image %r", image_ref)
        return

    # Local image attrs
    local_digest, image_size, last_pulled = _get_local_image_attrs(image_ref)

    # Registry digest
    try:
        registry, namespace, repo, tag = _parse_image_ref(image_ref)
        registry_digest = _fetch_registry_digest(registry, namespace, repo, tag)
    except Exception as exc:
        logger.warning(
            "image_checker: failed to fetch registry digest for %r (%r): %s",
            container.name,
            image_ref,
            exc,
        )
        registry_digest = None

    container.image_digest = local_digest
    container.registry_digest = registry_digest
    container.last_digest_check = datetime.utcnow()
    container.update_available = bool(
        registry_digest is not None
        and local_digest is not None
        and local_digest != registry_digest
    )
    if image_size is not None:
        container.image_size = image_size
    if last_pulled is not None:
        container.last_pulled = last_pulled

    if container.update_available and container.update_alert_sent_digest != container.registry_digest:
        _maybe_send_update_alert(session, container)

    session.add(container)
    logger.debug(
        "image_checker: %r — local=%s registry=%s update_available=%s",
        container.name,
        (local_digest or "")[:16],
        (registry_digest or "")[:16],
        container.update_available,
    )
