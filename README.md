<p align="center">
  <img src="landing/assets/nestview-wordmark.svg" alt="Nestview" height="60">
</p>

<br>

[![License: DBAD](https://img.shields.io/badge/license-DBAD-green.svg)](./LICENSE)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/kylejschultz?label=Sponsor&logo=githubsponsors&color=ea4aaa)](https://github.com/sponsors/kylejschultz)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support%20the%20project-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/kylejschultz)
[![Discord](https://img.shields.io/badge/Discord-join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/TfQ8QX3Ptr)

**Lightweight, self-hosted Docker visibility for homelabbers.**

Nestview gives you a live health dashboard, searchable log history, and Discord alerts for all your containers — no manual configuration, no Grafana stack required. Point it at your Docker socket and it discovers everything automatically.

---

## Quick start

```bash
# 1. Copy the example env file
cp .env.example .env

# 2. Start everything
docker compose up -d

# 3. Open http://localhost:8080 — the setup wizard will guide you through Discord alerts
```

That's it. Nestview will find all running and stopped containers immediately.

> **Security note:** `.env` is listed in `.gitignore` and must never be committed to version control — it may contain your Discord webhook URL and collector key.

---

## Environment variables

All configuration lives in `.env` (copy from `.env.example`).

| Variable | Default | Description |
|---|---|---|
| `NESTVIEW_PORT` | `8080` | Host port Nestview is exposed on |
| `NESTVIEW_COLLECTOR_KEY` | _(empty)_ | Optional shared secret to authenticate the collector |
| `LOG_RETENTION_DAYS` | `7` | Days of container logs and events to keep in SQLite |
| `EXITED_CONTAINER_TTL_HOURS` | `1` | Hours before exited/dead container records are purged from the DB (set to `0` to disable) |
| `POLL_INTERVAL` | `10` | Seconds between Docker stats polls |
| `LOG_BATCH_INTERVAL` | `5` | Seconds between log flushes to the backend |

---

## Features

- **Zero-config autodiscovery** — all containers, Compose stacks, ports, volumes, and networks detected automatically via the Docker socket
- **Live health dashboard** — per-container CPU%, memory, uptime, restart count, and status badge; containers grouped by Compose project
- **Searchable log history** — logs streamed from every running container, stored in SQLite, searchable from the UI
- **Configurable retention** — set `LOG_RETENTION_DAYS` to control storage; cleanup runs hourly
- **Discord alerting** — get a notification when a container crashes, restarts unexpectedly, or is OOM-killed

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  docker compose up                                   │
│                                                      │
│  ┌──────────────┐   HTTP POST   ┌──────────────────┐ │
│  │  collector   │ ────────────► │    backend       │ │
│  │  (Python)    │               │    (FastAPI)     │ │
│  │              │               │    SQLite DB     │ │
│  │  /var/run/   │               │    Discord hook  │ │
│  │  docker.sock │               └────────┬─────────┘ │
│  └──────────────┘                        │ /api/     │
│                                          ▼           │
│                              ┌──────────────────────┐ │
│                              │  frontend (nginx)    │ │
│                              │  React + TypeScript  │ │
│                              │  :8080               │ │
│                              └──────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

- **collector** mounts `/var/run/docker.sock` read-only and POSTs stats, logs, and events to the backend
- **backend** stores everything in SQLite and serves a REST API
- **frontend** is a React app built to static files, served by nginx; nginx also proxies `/api/` to the backend so everything is reachable on one port

---

## macOS notes

Docker Desktop on macOS proxies `/var/run/docker.sock` through the VM automatically — the collector works without any extra configuration.

If you use **Colima**, the socket is at the same path and works identically.

If you use **OrbStack**, the socket is also at `/var/run/docker.sock` and works without changes.

If Docker's socket is at a different path on your machine, update the collector volume mount in `docker-compose.yml`:

```yaml
volumes:
  - /path/to/docker.sock:/var/run/docker.sock:ro
```

---

## Discord alerts

1. In your Discord server, go to **Server Settings → Integrations → Webhooks → New Webhook**
2. Copy the webhook URL
3. Open Nestview and paste the URL into the setup wizard (shown on first launch) or **Settings → General**

Nestview sends a formatted embed when a container crashes (non-zero exit), is OOM-killed, or restarts unexpectedly.

---

## Data storage

SQLite database is stored at `/data/nestview.db` inside the `nestview_data` Docker volume. To back it up:

```bash
docker compose cp backend:/data/nestview.db ./nestview-backup.db
```

To reset all data:

```bash
docker compose down -v
```

---

## Updating

```bash
docker compose pull   # if using published images
docker compose build --no-cache
docker compose up -d
```

---

## Local development

**Backend:**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DATABASE_PATH=./dev.db uvicorn backend.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev   # proxies /api to localhost:8000
```

**Collector** (requires Docker socket access):
```bash
cd collector
pip install -r requirements.txt
BACKEND_URL=http://localhost:8000 python main.py
```

---

## License

[Don't Be a Dick Public License](./LICENSE) — free to use, modify, and self-host. Just don't be a dick about it.

## Community & support

- [Discord](https://discord.gg/TfQ8QX3Ptr) — bug reports, general chat, release announcements
- [GitHub Issues](https://github.com/kylejschultz/nestview/issues) — bugs and feature requests
- [GitHub Sponsors](https://github.com/sponsors/kylejschultz) / [Ko-fi](https://ko-fi.com/kylejschultz) — if Nestview saves you time, a coffee is always appreciated

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). TL;DR: open an issue before big changes, follow conventional commits, don't be a dick.
