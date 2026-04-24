# Changelog

All notable changes to Nestview are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.0.0] — Unreleased

### Added

- Auth mode selector in the setup wizard — choose between standard login or no-auth during first-run setup
- Auth mode toggle in Settings — switch between standard and no-auth with inline credential setup and explicit confirmation flow

### Changed

- Backend cleanup pass: extracted constants, fixed logging initialization order, removed dead endpoints, cleaned up imports
- Frontend cleanup pass: extracted `NestviewLogo` component, removed dead code, fixed JSX issues, deduplicated React Query hooks
- Docker image hardened: HEALTHCHECK added, pip cache disabled; non-root USER reverted due to Docker socket permission conflict
- GitHub Actions workflows pinned to full commit SHAs; `github-actions` ecosystem added to Dependabot

### Fixed

- Session cookie now correctly awaited and cleared before redirecting to login on logout
- Auth mode switching flow corrected in Settings and setup wizard
- Bumped Python and npm dependencies (fastapi, uvicorn, requests, vite, react-router-dom, postcss)

---

## [0.5.0] — 2026-04-15

### Added

- Versioned migration system using SQLAlchemy inspect — replaces ad-hoc schema patching; eliminates startup boot loop
- Per-container network I/O (rx/tx bytes) tracking with configurable history retention
- Network I/O line chart on container detail page (Recharts), with date boundaries on X-axis and tiered Y-axis scaling
- Configurable network I/O history retention in Settings
- Log export endpoint (`GET /api/logs/{id}/export`) with download button in the UI
- Generic OCI bearer-auth digest fetcher; `lscr.io` support added to image update checker
- Git SHA embedded in dev image, surfaced as a version tooltip
- `BUILD_CHANNEL` build arg for dev image self-identification in CI

### Changed

- Container card image subtitle replaced with registry badge and tag pill
- "Pull & restart" action replaced by "Check for updates" and "Update & restart" with live progress steps
- Exited container TTL moved to Settings UI (configurable in seconds with slider); `EXITED_CONTAINER_TTL_HOURS` env var removed
- SQLite database storage switched from named Docker volume to host-path bind mount (`./data`)
- Dev image CI build scoped to arm64 (M-series) only

### Fixed

- OCI and Docker manifest `Accept` headers included in digest fetch requests
- Missing `last_pulled` field added to `Container` model (migration 002)
- Container name included in log export filenames
- Bumped Python and npm dependencies (pydantic, fastapi, vite, react-router-dom, postcss)

---

## [0.4.1] — 2026-04-11

### Fixed

- Navigating to `/login` while already authenticated now redirects to the dashboard instead of rendering a blank page

---

## [0.4.0] — 2026-04-10

### Added

- Mandatory authentication — username and password required on first run; bcrypt-hashed credentials stored in SQLite `AppSetting` table
- First-run setup page (`/setup`) — collects username, password, and auth mode before the dashboard is accessible; cannot be bypassed
- "No authentication" escape hatch — available during setup with explicit double-confirmation; appropriate for users behind an external auth proxy (Authelia, Authentik, nginx basic auth)
- Login page (`/login`) — standard username/password form; session cookie set on success
- Session management — signed httpOnly cookie via `itsdangerous`; session signing key auto-generated on first start and persisted in SQLite
- Logout button in the navbar
- Session expiry configurable in Settings UI (default 7 days)
- `RESET_ADMIN_PASSWORD=true` env var — clears stored credentials and re-triggers the setup wizard on next start
- `SECRET_KEY` env var — optional override for the auto-generated session signing key; useful for scripted deployments
- `GET /api/auth/status` — returns `setup_required` and `auth_mode`; always public
- `POST /api/auth/setup` — first-run credential setup; returns 409 if already configured
- `POST /api/auth/login` — exchanges credentials for a session cookie
- `POST /api/auth/logout` — clears the session cookie
- `GET /api/auth/me` — returns current session info; 401 if not authenticated
- SPA catch-all route — FastAPI now serves `index.html` for all non-API routes, enabling hard refresh on any frontend route
- Change password in Settings UI — update credentials without restarting the container

---

## [0.3.0] — 2026-04-08

### Changed

- Collapsed three-container stack (backend, collector, frontend) into a single image (`ghcr.io/kylejschultz/nestview`)
- Collector logic now runs as daemon threads inside the backend process — no separate container or inter-service HTTP required
- React frontend is embedded in the image and served directly by FastAPI via `StaticFiles` — nginx container removed
- `docker-compose.yml` simplified to a single `nestview` service
- `docker run` one-liner now supported as an alternative to Compose
- Removed `NESTVIEW_COLLECTOR_KEY` and `BACKEND_URL` environment variables

### Removed

- `nestview-backend`, `nestview-collector`, and `nestview-frontend` images superseded by `nestview`

---

## [0.2.0] — 2026-04-06

### Added

- Image update detection — background job checks running containers for newer digests on Docker Hub and GHCR on a configurable daily schedule
- Discord alerts for available image updates — notification sent when a newer digest is detected for a running container
- Image size and last digest check timestamp on the container detail page
- Per-container actions — start, stop, restart, and pull & restart with confirmation modal and live progress steps
- Stack-level actions — start, stop, restart, and pull & restart applied across all containers in a Compose project

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
