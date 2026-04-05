# Changelog

All notable changes to Nestview are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.2.0] — 2026-04-03

### Added

- Image update checker — detects when a newer digest is available on Docker Hub or GHCR and sets `update_available` flag per container
- Discord alerts for available image updates (dispatched by the image check cron)
- Update available badge on the dashboard container cards
- Image size and pull history displayed on the per-container detail page
- Per-container pull + restart action (pulls latest image then restarts the container)
- Stack-level actions: pull & restart all, stop all, start all containers in a Compose project

---

## [0.1.0] — 2026-03-31

Initial release.

### Added

- Zero-config container autodiscovery via Docker socket (read-only mount)
- Live health dashboard — CPU%, memory, uptime, restart count per container
- Containers grouped by Docker Compose project in the dashboard
- Per-container detail page with full stats, port/volume/network info
- Container log streaming — all running containers streamed and stored in SQLite
- Searchable log viewer with auto-scroll toggle
- Configurable log retention via `LOG_RETENTION_DAYS` (default: 7 days); hourly cleanup job
- Discord webhook alerts on container crash (non-zero exit), OOM kill, and unexpected restart
- Event timeline on the dashboard and per-container detail page
- Single `docker compose up` deployment — backend, collector, and frontend in one command
- SQLite storage via SQLModel — no external database
- nginx reverse proxy — frontend and API on a single port (`NESTVIEW_PORT`, default 8080)
- `.env.example` with documentation for all configuration variables
