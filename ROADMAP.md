# Nestview Roadmap

## v1.0 — Current release

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

## v1.1 — Log intelligence

Make logs more useful without adding infrastructure complexity.

- [ ] **Log pattern alerting** — configure regex patterns in `.env`; get a Discord alert when a line matches (e.g., `ERROR`, `OOM`, custom strings)
- [ ] **Log severity coloring** — automatic detection of ERROR / WARN / DEBUG lines in the UI
- [ ] **Log export** — download logs for a container or time range as plain text
- [ ] **Log bookmarks** — mark a specific log line to return to later

---

## v1.2 — Image and update awareness

Know when your containers are running outdated images.

- [ ] **Image update notifications** — detect when a newer digest is available on Docker Hub or GHCR; alert via Discord
- [ ] **Image pull history** — track when each image was last pulled
- [ ] **Image size display** — show image size on the container detail page

---

## v1.3 — Multi-host support

For homelabs with more than one machine.

- [ ] **Remote host agents** — run a lightweight collector on any Docker host and connect it to a central Nestview instance
- [ ] **Host switcher** — toggle between hosts in the dashboard UI
- [ ] **Cross-host event stream** — single Discord channel for all your hosts

---

## v1.4 — Network traffic visibility

Understand what your containers are actually talking to.

- [ ] **Per-container network I/O stats** — bytes in/out displayed on the dashboard
- [ ] **Network I/O history** — sparkline chart on the container detail page
- [ ] **Port scan detection** — alert when a container starts receiving traffic on an unexpected port

---

## Ideas under consideration

- Scheduled container restarts (cron-style from the UI)
- Container action buttons (stop/start/restart) with confirmation
- Email alerting as an alternative to Discord
- Mobile-friendly PWA layout
- Prometheus metrics endpoint (`/metrics`) for users who do run Grafana
