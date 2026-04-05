# CLAUDE.md — Nestview

Nestview is a lightweight, self-hosted Docker visibility tool for homelabbers. It provides zero-config autodiscovery of containers, a live health dashboard, searchable log history, and Discord alerting — deployed via a single `docker compose up`.

---

## Architecture

Three services, all containerized and orchestrated via Docker Compose:

```
collector (Python)
  └── reads /var/run/docker.sock (read-only)
  └── POSTs stats, logs, events → backend

backend (FastAPI + SQLModel + SQLite)
  └── stores all data in /data/nestview.db
  └── serves REST API at :8000
  └── reads /var/run/docker.sock (writable, for container actions)

frontend (React + TypeScript + Vite → nginx)
  └── served as static files at :8080
  └── nginx proxies /api/ → backend:8000
```

**No migrations.** SQLModel calls `SQLModel.metadata.create_all(engine)` on startup. Schema changes require manual handling or a full reset.

---

## Repository Layout

```
nestview/
├── backend/
│   ├── api/
│   │   ├── auth.py          # X-Collector-Key header verification
│   │   ├── actions.py       # Container start/stop/restart (POST)
│   │   ├── containers.py    # Container CRUD + batch reconciliation
│   │   ├── events.py        # Event ingestion + Discord alert dispatch
│   │   ├── logs.py          # Log ingestion + search
│   │   └── settings.py      # Per-container alert enable/disable
│   ├── services/
│   │   ├── cleanup.py       # APScheduler hourly job (log/event/container TTL)
│   │   └── discord.py       # Discord webhook embed sender
│   ├── database.py          # SQLite engine + session factory
│   ├── models.py            # SQLModel table definitions
│   ├── main.py              # FastAPI app entrypoint
│   └── requirements.txt
├── collector/
│   └── main.py              # Docker socket poller + log streamer + event watcher
├── frontend/
│   ├── src/
│   │   ├── api.ts           # All API calls (typed)
│   │   ├── types.ts         # Shared TypeScript interfaces
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Logs.tsx
│   │   │   └── Settings.tsx
│   │   └── components/
│   │       ├── ContainerCard.tsx
│   │       └── EventTimeline.tsx
│   ├── nginx.conf
│   └── package.json
├── landing/                 # Static marketing page (index.html)
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Key Conventions

### Backend

- **FastAPI routers** are in `backend/api/`. Each file owns one domain and registers its own `APIRouter`. Routers are mounted in `main.py`.
- **Models** live in `backend/models.py` — four tables: `Container`, `ContainerLog`, `ContainerEvent`, `ContainerAlertSetting`.
- **No Alembic.** `create_db_and_tables()` auto-creates on startup. If you add a column to a model, the existing DB will not have it — drop and recreate, or write a one-off migration with raw SQLite.
- **Collector-facing POST endpoints** use `Depends(verify_collector_key)` from `api/auth.py`. This checks the `X-Collector-Key` header against `NESTVIEW_COLLECTOR_KEY`. If the env var is empty, the check is skipped (trusted-network mode).
- **Container state reconciliation** happens in `POST /api/containers/batch`. The collector sends a full `docker ps -a` snapshot; anything not in the batch is deleted. Ghost detection (same name/project, old container exited + new one running) also fires here.
- **Ports, volumes, networks** are stored as JSON strings in SQLite and parsed to lists on read. Don't change this without updating the batch ingest and `list_containers` / `get_container` responses.
- **Event types tracked by the collector:** `start`, `stop`, `die`, `kill`, `restart`, `oom`. `die` with non-zero exit code is mapped to `crash`. The `die` event reuses the `crash` alert setting key.
- **Cleanup** runs hourly via APScheduler. Log/event retention is `LOG_RETENTION_DAYS`. Exited/dead container rows are TTL-purged after `EXITED_CONTAINER_TTL_HOURS` (fractional hours supported; set to `0` to disable).

### Collector

- Single file: `collector/main.py`.
- Three concurrent threads: stats poller, log batch flusher, Docker event watcher.
- Log buffer is flushed to the backend every `LOG_BATCH_INTERVAL` seconds (default 5). Flush is batched — do not change to per-line POSTs.
- The collector waits for `GET /api/health` to return 200 before starting its threads (handled by Docker `depends_on: condition: service_healthy` plus an internal `_wait_for_backend()` loop).
- Stats use `container.stats(stream=False)` — one blocking call per container per poll. CPU% formula follows Docker's own calculation. Memory subtracts cache from usage.

### Frontend

- **React Query** for all data fetching; all API calls go through `src/api.ts`. Do not use `fetch` directly in components.
- **Tailwind CSS** with a custom dark theme. CSS variables are defined in the global stylesheet (`bg-surface-2`, `bg-surface-3`, `bg-accent`, `border-border`, etc.). Use these — don't hardcode colors.
- **Compose project grouping** is handled in `Dashboard.tsx` (`ComposeGroup`) and `Settings.tsx`. Collapsed state is persisted to `localStorage` under `nestview:stack_collapsed`.
- **No form elements.** Use `onClick`/`onChange` handlers directly. Avoid `<form>` tags.
- **Routing:** React Router v6. Pages: `/` (Dashboard), `/logs` (Logs), `/settings` (Settings).
- `npm run build` produces static files; nginx serves them and proxies `/api/` to `backend:8000`.

---

## Environment Variables

All config is in `.env` (copy from `.env.example`). Docker Compose auto-loads it.

| Variable | Default | Notes |
|---|---|---|
| `NESTVIEW_PORT` | `8080` | Host port for the frontend |
| `NESTVIEW_COLLECTOR_KEY` | _(empty)_ | Shared secret for collector auth; leave empty on trusted networks |
| `DISCORD_WEBHOOK_URL` | _(empty)_ | Leave blank to disable alerting |
| `LOG_RETENTION_DAYS` | `7` | Retention for logs and events |
| `EXITED_CONTAINER_TTL_HOURS` | `0.083` (~5 min) | TTL for stale exited/dead container rows; set to `0` to disable |
| `POLL_INTERVAL` | `10` | Seconds between Docker stats polls |
| `LOG_BATCH_INTERVAL` | `5` | Seconds between log flushes |

**Never commit `.env`.** It is in `.gitignore`. It may contain a Discord webhook URL or collector key.

---

## Local Development

**Backend** (requires Python 3.11+):
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DATABASE_PATH=./dev.db uvicorn main:app --reload
# API available at http://localhost:8000
# Swagger UI at http://localhost:8000/docs
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# Vite proxies /api/ to localhost:8000
# UI at http://localhost:5173
```

**Collector** (requires access to Docker socket):
```bash
cd collector
pip install -r requirements.txt
BACKEND_URL=http://localhost:8000 python main.py
```

**Full stack via Compose:**
```bash
cp .env.example .env   # edit as needed
docker compose up --build
# UI at http://localhost:8080
```

---

## API Endpoints

All endpoints are prefixed `/api/`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | none | Liveness probe |
| `GET` | `/containers` | none | List all containers |
| `GET` | `/containers/{docker_id}` | none | Single container |
| `POST` | `/containers/batch` | collector key | Full reconciliation snapshot |
| `POST` | `/containers/{docker_id}/start` | none | Start container |
| `POST` | `/containers/{docker_id}/stop` | none | Stop container |
| `POST` | `/containers/{docker_id}/restart` | none | Restart container |
| `GET` | `/containers/{docker_id}/logs` | none | Container logs (paginated, searchable) |
| `GET` | `/logs` | none | All logs (paginated, searchable) |
| `POST` | `/collector/logs` | collector key | Batch log ingest |
| `GET` | `/collector/events` | none | Event timeline |
| `POST` | `/collector/events` | collector key | Ingest a single event |
| `GET` | `/settings/alerts` | none | List alert settings |
| `PATCH` | `/settings/alerts` | none | Enable/disable an alert type per container |

---

## Data Notes

- **SQLite DB** lives in the `nestview_data` Docker volume at `/data/nestview.db`.
- **Backup:** `docker compose cp backend:/data/nestview.db ./nestview-backup.db`
- **Full reset:** `docker compose down -v`
- Ports, volumes, and networks are JSON-encoded strings in the DB. They are decoded to arrays in all GET responses. The frontend receives them as `string[]`.

---

## Versioning

The `VERSION` file at the repo root is the single source of truth for the app version. It contains a plain semver string (e.g. `1.0.0`) with no prefix.

- The backend reads it at startup (`/app/VERSION` inside the container) and exposes it via `GET /api/version`.
- The frontend fetches `/api/version` on load and displays it in the footer.
- **Never hardcode the version string** in backend or frontend source files.
- **Bump `VERSION` manually** before cutting a GitHub release, then tag the commit (e.g. `git tag v1.1.0`).

---

## Git Conventions

**Commit style:** Use [Conventional Commits](https://www.conventionalcommits.org/).

```
feat: add per-container log retention override
fix: prevent empty batch from wiping container table
chore: bump fastapi to 0.115.1
docs: update env var table in README
refactor: extract discord embed builder to helper
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`.

**When to commit:** Commit when a logical unit of work is complete — a passing feature, a self-contained fix, a cleanup. Don't batch unrelated changes into one commit and don't commit half-finished work.

**Main branch:** No WIP commits to `main`. If work isn't in a shippable state, keep it on a feature branch or leave it uncommitted locally.

---

## Workflow

After completing any task:
1. Commit all changes using conventional commit format (see Git Conventions above)
2. Push to `dev`
3. Before opening a PR, check if one already exists:
   ```
   gh pr list --base main --head dev --state open
   ```
   - If an open PR already exists, do not create a new one. Note the existing PR URL and confirm the latest commits have been pushed to `dev` — the PR will update automatically.
   - If no open PR exists, create one:
     ```
     gh pr create --base main --title "<descriptive title>" --body "<brief summary of what was done>"
     ```

Never push directly to `main`. All work happens on `dev` and goes to `main` via PR.

---

## Common Pitfalls

- **Schema changes** are not auto-migrated. Drop the volume and restart, or write raw SQL.
- **Empty collector batch** — the batch endpoint has a guard: if `seen_ids` is empty, reconciliation is skipped to avoid wiping the table when Docker is temporarily unreachable.
- **`die` vs `crash`** — the collector maps `die` + non-zero exit to `crash`, but both share the `crash` alert setting. Don't add a separate `die` setting without updating `_SETTING_KEY` in `events.py`.
- **Backend also mounts the Docker socket** (writable) for the actions API. The collector socket mount is read-only. Both are intentional.
- **macOS/Colima/OrbStack** all expose the socket at `/var/run/docker.sock` — no config changes needed. Only non-standard socket paths require updating the volume mount in `docker-compose.yml`.