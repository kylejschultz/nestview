# Nestview Roadmap

## v0.5.0 — Current release

Observability enhancements: network I/O visibility, log severity coloring, and log export.

- [x] Per-container network I/O stats (bytes in/out) on the dashboard
- [x] Network I/O history — sparkline chart on the container detail page
- [x] Log severity coloring — automatic detection of ERROR / WARN / DEBUG lines in the UI
- [x] Log export — download logs for a container or time range as plain text

---

## v0.4.1

Stability and bug fix release.

- [x] Bug fixes and minor improvements following the v0.4.0 auth rollout

---

## v0.4.0

Mandatory authentication with first-run setup wizard.

- [x] Mandatory authentication — dashboard is inaccessible until credentials are created
- [x] Setup wizard — first-run flow to create a username and password before the dashboard loads
- [x] bcrypt-hashed credential storage in `AppSetting`
- [x] Signed httpOnly session cookies via `itsdangerous`
- [x] "No authentication" escape hatch for users behind an external auth proxy
- [x] `RESET_ADMIN_PASSWORD` env var to clear credentials and re-trigger the setup wizard

---

## v0.3.0

Mono-image architecture — collector refactored into in-process daemon threads.

- [x] Collector runs as daemon threads inside the backend service (no separate container or process)
- [x] Single `docker compose up` deploys exactly one container
- [x] `NESTVIEW_SECURE_COOKIES` env var for reverse-proxy deployments

---

## v0.2.0

Image update awareness, pull + restart actions, and dashboard update badges.

- [x] Image update checker — background job polls Docker Hub / GHCR for newer digests on a configurable schedule
- [x] Discord alerts for available image updates — notification sent when a newer digest is detected for a running container
- [x] Update badges on the dashboard — visual indicator on container cards when an update is available
- [x] Image size display on the container detail page
- [x] Last digest check timestamp on the container detail page
- [x] Per-container actions (start, stop, restart, pull & restart)
- [x] Stack-level actions (start, stop, restart, pull & restart)

---

## v0.1.0

Core visibility and alerting for self-hosted Docker environments.

- [x] Zero-config container autodiscovery via Docker socket
- [x] Live CPU, memory, uptime, and restart-count dashboard
- [x] Containers grouped by Compose project
- [x] Per-container log streaming with searchable history
- [x] Configurable log retention (default 7 days)
- [x] Discord webhook alerts on crash, restart, OOM kill
- [x] Single `docker compose up` deployment
- [x] SQLite storage — no external database required

---

## Log intelligence

Make logs more useful without adding infrastructure complexity.

- [ ] **Log pattern alerting** — configure regex patterns; get a Discord alert when a line matches (e.g., `ERROR`, `OOM`, custom strings)
- [ ] **Log bookmarks** — mark a specific log line to return to later

---

## Multi-host support

For homelabs with more than one machine.

- [ ] **Remote host agents** — run a lightweight collector on any Docker host and connect it to a central Nestview instance
- [ ] **Host switcher** — toggle between hosts in the dashboard UI
- [ ] **Cross-host event stream** — single Discord channel for all your hosts

---

## Network security visibility

- [ ] **Port scan detection** — alert when a container starts receiving traffic on an unexpected port

---

## Ideas under consideration

- Scheduled container restarts (cron-style from the UI)
- Email alerting as an alternative to Discord
- Mobile-friendly PWA layout
- Prometheus metrics endpoint (`/metrics`) for users who do run Grafana
