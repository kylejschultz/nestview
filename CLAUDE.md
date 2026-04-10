# CLAUDE.md — Nestview

Nestview is a lightweight, self-hosted Docker visibility tool for homelabbers. It provides zero-config autodiscovery of containers, a live health dashboard, searchable log history, and Discord alerting — deployed via a single `docker compose up`.

---

## Architecture

Single container, deployed via Docker Compose:

```
nestview (FastAPI + SQLModel + SQLite + embedded React)
  └── reads /var/run/docker.sock (writable, for stats + actions)
  └── serves REST API at :8080/api/
  └── serves React SPA at :8080/ (StaticFiles)
  └── runs collector threads in-process (stats poll, log stream, event watcher)
```

**No migrations.** SQLModel calls `SQLModel.metadata.create_all(engine)` on startup. Schema changes require manual handling or a full reset.

---

## Repository Layout

```
nestview/
├── backend/
│   ├── api/
│   │   ├── actions.py       # Container start/stop/restart (POST)
│   │   ├── containers.py    # Container CRUD + batch reconciliation
│   │   ├── events.py        # Event ingestion + Discord alert dispatch
│   │   ├── logs.py          # Log ingestion + search
│   │   └── settings.py      # Per-container alert enable/disable
│   ├── services/
│   │   ├── cleanup.py       # APScheduler hourly job (log/event/container TTL)
│   │   ├── collector.py     # In-process collector threads (stats, logs, events)
│   │   └── discord.py       # Discord webhook embed sender
│   ├── database.py          # SQLite engine + session factory
│   ├── models.py            # SQLModel table definitions
│   ├── main.py              # FastAPI app entrypoint
│   └── requirements.txt
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
│   └── package.json
├── landing/                 # Static marketing page (index.html)
├── Dockerfile               # Multi-stage: node build → python final
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
- The collector runs in-process as daemon threads and writes directly to the DB via SQLModel — there are no HTTP endpoints for collector ingest.
- **Container state reconciliation** happens in `_apply_batch()` in `services/collector.py`. The stats loop sends a full `docker ps -a` snapshot; anything not in the batch is deleted. Ghost detection (same name/project, old container exited + new one running) also fires here.
- **Ports, volumes, networks** are stored as JSON strings in SQLite and parsed to lists on read. Don't change this without updating the batch ingest and `list_containers` / `get_container` responses.
- **Event types tracked by the collector:** `start`, `stop`, `die`, `kill`, `restart`, `oom`. `die` with non-zero exit code is mapped to `crash`. The `die` event reuses the `crash` alert setting key.
- **Cleanup** runs hourly via APScheduler. Log/event retention is `LOG_RETENTION_DAYS`. Exited/dead container rows are TTL-purged after `EXITED_CONTAINER_TTL_HOURS` (fractional hours supported; set to `0` to disable).

### Collector

- Lives in `backend/services/collector.py`. Started as daemon threads from the FastAPI `lifespan` function via `start_collector()`.
- Two daemon threads: `collector-stats` (stats poll + log flush) and `collector-events` (Docker event watcher).
- Log buffer is flushed to the DB directly every `LOG_BATCH_INTERVAL` seconds (default 5). Individual log-stream threads are spawned per running container from within the stats loop.
- Stats use `container.stats(stream=False)` — one blocking call per container per poll. CPU% formula follows Docker's own calculation. Memory subtracts cache from usage.
- Discord alerts for events are fired inline in `_watch_events()` using `asyncio.run()` (safe because the thread has no running event loop).

### Frontend

- **React Query** for all data fetching; all API calls go through `src/api.ts`. Do not use `fetch` directly in components.
- **Tailwind CSS** with a custom dark theme. CSS variables are defined in the global stylesheet (`bg-surface-2`, `bg-surface-3`, `bg-accent`, `border-border`, etc.). Use these — don't hardcode colors.
- **Compose project grouping** is handled in `Dashboard.tsx` (`ComposeGroup`) and `Settings.tsx`. Collapsed state is persisted to `localStorage` under `nestview:stack_collapsed`.
- **No form elements.** Use `onClick`/`onChange` handlers directly. Avoid `<form>` tags.
- **Routing:** React Router v6. Pages: `/` (Dashboard), `/logs` (Logs), `/settings` (Settings), `/login` (Login), `/setup` (First-run setup). The app gates all routes behind `/setup` if `setup_required` is true, and behind `/login` if the session is invalid.
- `npm run build` produces static files; the Dockerfile copies `dist/` to `/app/static` and FastAPI serves them via `StaticFiles`.

---

## Environment Variables

All config is in `.env` (copy from `.env.example`). Docker Compose auto-loads it.

| Variable | Default | Notes |
|---|---|---|
| `NESTVIEW_PORT` | `8484` | Host port exposed to the host |
| `DISCORD_WEBHOOK_URL` | _(empty)_ | Leave blank to disable alerting |
| `LOG_RETENTION_DAYS` | `7` | Retention for logs and events |
| `EXITED_CONTAINER_TTL_HOURS` | `0.083` (~5 min) | TTL for stale exited/dead container rows; set to `0` to disable |
| `POLL_INTERVAL` | `10` | Seconds between Docker stats polls |
| `LOG_BATCH_INTERVAL` | `5` | Seconds between log flushes |
| `SECRET_KEY` | _(auto-generated)_ | Optional override for the session signing key. Auto-generated and persisted in `AppSetting` if not set. |
| `RESET_ADMIN_PASSWORD` | _(unset)_ | Set to `true` to clear stored credentials and re-trigger setup wizard on next start. |

> **Authentication:** v0.4.0 introduces mandatory auth. On first run, the setup wizard requires a username and password before the dashboard is accessible. Credentials are bcrypt-hashed and stored in `AppSetting`. Sessions use a signed httpOnly cookie via `itsdangerous`. A `RESET_ADMIN_PASSWORD=true` env var clears credentials and re-triggers the wizard. An "auth_mode = none" escape hatch is available for users behind an external auth proxy.

**Never commit `.env`.** It is in `.gitignore`. It may contain a Discord webhook URL.

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

**Full stack via Compose** (single service):
```bash
cp .env.example .env   # edit as needed
docker compose up --build
# UI at http://localhost:8484
```

---

## API Endpoints

All endpoints are prefixed `/api/`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | none | Liveness probe |
| `GET`  | `/auth/status`  | none | Setup status and auth mode |
| `POST` | `/auth/setup`   | none | First-run credential setup (409 if already done) |
| `POST` | `/auth/login`   | none | Exchange credentials for session cookie |
| `POST` | `/auth/logout`  | none | Clear session cookie |
| `GET`  | `/auth/me`      | none | Current session info (401 if not authenticated) |
| `POST` | `/auth/change-password` | cookie | Update the admin password (requires current password) |
| `GET` | `/containers` | cookie | List all containers |
| `GET` | `/containers/{docker_id}` | cookie | Single container |
| `POST` | `/containers/{docker_id}/start` | cookie | Start container |
| `POST` | `/containers/{docker_id}/stop` | cookie | Stop container |
| `POST` | `/containers/{docker_id}/restart` | cookie | Restart container |
| `POST` | `/containers/{docker_id}/pull-restart` | cookie | Pull latest image and restart container |
| `GET` | `/containers/{docker_id}/logs` | cookie | Container logs (paginated, searchable) |
| `GET` | `/logs` | cookie | All logs (paginated, searchable) |
| `GET` | `/collector/events` | cookie | Event timeline |
| `GET` | `/settings/alerts` | cookie | List alert settings |
| `PATCH` | `/settings/alerts` | cookie | Enable/disable an alert type per container |
| `POST` | `/stacks/{compose_project}/stop` | cookie | Stop all containers in a compose stack |
| `POST` | `/stacks/{compose_project}/start` | cookie | Start all containers in a compose stack |
| `POST` | `/stacks/{compose_project}/restart` | cookie | Restart all containers in a compose stack |
| `POST` | `/stacks/{compose_project}/pull-restart` | cookie | Pull latest images and restart a compose stack |
| `POST` | `/admin/check-images` | cookie | Trigger an immediate image update check |

---

## Data Notes

- **SQLite DB** lives in the `nestview_data` Docker volume at `/data/nestview.db`.
- **Backup:** `docker compose cp nestview:/data/nestview.db ./nestview-backup.db`
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
1. Commit all changes using conventional commit format
2. Push to `dev`
3. Handle the PR:
   - Check for any open PRs from dev to main: `gh pr list --base main --head dev --state open`
   - If an open PR exists, read its current commit list and evaluate whether the new commit(s) are part of the same logical effort (same feature, same bug, same area of the app). Use commit messages and scopes (e.g. `feat(frontend):`, `fix(collector):`) as the primary signal.
     - If yes: regenerate the full PR body to reflect all commits currently in the PR. Use a `## Summary` section grouping changes by conventional commit type, and a `## Commits` section with short SHA + message per commit. Apply with `gh pr edit <number> --body "..."`.
     - If no: open a new PR for the new commit(s) with `gh pr create --base main --title "<descriptive title>" --body "<summary>"`
   - If no open PR exists: create one with `gh pr create --base main --title "<descriptive title>" --body "<summary>"`

Never push directly to `main`. All work happens on `dev` and goes to `main` via PR.

---

## Common Pitfalls

- **Schema changes** are not auto-migrated. Drop the volume and restart, or write raw SQL.
- **Empty collector batch** — `_apply_batch()` in `services/collector.py` has a guard: if `seen_ids` is empty, reconciliation is skipped to avoid wiping the table when Docker is temporarily unreachable.
- **`die` vs `crash`** — the collector maps `die` + non-zero exit to `crash`, but both share the `crash` alert setting. Don't add a separate `die` setting without updating `_SETTING_KEY` in both `events.py` and `services/collector.py`.
- **Single writable Docker socket mount** — the socket is mounted writable for both container actions and the in-process collector stats polling.
- **macOS/Colima/OrbStack** all expose the socket at `/var/run/docker.sock` — no config changes needed. Only non-standard socket paths require updating the volume mount in `docker-compose.yml`.
- **Collector writes directly to DB** — there are no HTTP endpoints for collector ingest. The collector runs in-process and uses SQLModel sessions directly.
- **`RESET_ADMIN_PASSWORD` must be removed after use** — leaving it set means every restart clears credentials. Document this clearly when advising users.