# CLAUDE.md — Nestview

Nestview is a lightweight, self-hosted Docker visibility tool for homelabbers. It provides zero-config autodiscovery of containers, a live health dashboard, searchable log history, and Discord alerting — deployed via a single `docker compose up`.

---

## Architecture

Single container, deployed via Docker Compose:

```
nestview (FastAPI + SQLModel + SQLite + embedded React)
  └── reads /var/run/docker.sock (writable, for stats + actions)
  └── serves REST API at :8484/api/
  └── serves React SPA at :8484/ (StaticFiles)
  └── runs collector threads in-process (stats poll, log stream, event watcher)
```

---

## Repository Layout

```
nestview/
├── backend/
│   ├── api/
│   │   ├── actions.py       # Container start/stop/restart (POST)
│   │   ├── admin.py         # Admin / credential management endpoints
│   │   ├── auth.py          # Login, logout, session endpoints
│   │   ├── containers.py    # Container CRUD + batch reconciliation
│   │   ├── events.py        # Container event history (GET endpoints only)
│   │   ├── logs.py          # Log search + export
│   │   ├── settings.py      # Per-container alert enable/disable
│   │   └── stack_actions.py # Compose stack-level actions (POST)
│   ├── services/
│   │   ├── app_settings.py  # DB-backed app settings helpers
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
- **Models** live in `backend/models.py` — six tables: `Container`, `ContainerLog`, `ContainerEvent`, `ContainerAlertSetting`, `AppSetting`, `ContainerNetworkHistory`.
- **Schema migrations** are handled by `backend/migrations.py` — a lightweight custom system, not Alembic. There is no alembic package or dependency. `create_db_and_tables()` handles fresh installs via SQLModel's `create_all`. Upgrades are handled by a sequential list of versioned migration functions in `migrations.py`, with the current version tracked in the `AppSetting` table under key `schema_version`. To add a column: add it to the model as `Optional` with a default, then append a new `(version_str, fn)` entry to the `MIGRATIONS` list in `migrations.py`. Failures raise loudly — do not swallow migration exceptions.
- The collector runs in-process as daemon threads and writes directly to the DB via SQLModel — there are no HTTP endpoints for collector ingest.
- **Container state reconciliation** happens in `_apply_batch()` in `services/collector.py`. The stats loop sends a full `docker ps -a` snapshot; anything not in the batch is deleted. Ghost detection (same name/project, old container exited + new one running) also fires here.
- **Ports, volumes, networks** are stored as JSON strings in SQLite and parsed to lists on read. Don't change this without updating the batch ingest and `list_containers` / `get_container` responses.
- **Event types tracked by the collector:** `start`, `stop`, `die`, `kill`, `restart`, `oom`. `die` with non-zero exit code is mapped to `crash`. The `die` event reuses the `crash` alert setting key.
- **Cleanup** runs hourly via APScheduler. Log/event retention is `LOG_RETENTION_DAYS`. Exited/dead container rows are TTL-purged after `exited_container_ttl_seconds` (a DB-stored setting managed via the Settings UI; set to `0` to disable).

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
- **Routing:** React Router v6. Pages: `/` (Dashboard), `/containers/:id` (Container detail), `/settings` (Settings), `/login` (Login), `/setup` (First-run setup). The app gates all routes behind `/setup` if `setup_required` is true, and behind `/login` if the session is invalid.
- `npm run build` produces static files; the Dockerfile copies `dist/` to `/app/static` and FastAPI serves them via `StaticFiles`.

---

## Environment Variables

All config is in `.env` (copy from `.env.example`). Docker Compose auto-loads it.

| Variable | Default | Notes |
|---|---|---|
| `LOG_RETENTION_DAYS` | `7` | Seeded from env on first run only, then stored in the DB. Changes after initial setup must be made in the Settings UI — live env var changes have no effect. |
| `POLL_INTERVAL` | `10` | Seconds between Docker stats polls |
| `LOG_BATCH_INTERVAL` | `5` | Seconds between log flushes |
| `SECRET_KEY` | _(auto-generated)_ | Optional override for the session signing key. Auto-generated and persisted in `AppSetting` if not set. |
| `RESET_ADMIN_PASSWORD` | _(unset)_ | Set to `true` to clear stored credentials and re-trigger setup wizard on next start. |
| `NESTVIEW_SECURE_COOKIES` | `false` | Set to `true` when Nestview is behind a TLS-terminating reverse proxy. Marks session cookies as `Secure` so they are only sent over HTTPS. |

> **Discord webhook URL** is configured in the Settings UI (stored in the DB), not as an environment variable.

> **Exited container TTL** is configured via `exited_container_ttl_seconds` in the Settings UI (DB-stored). The old `EXITED_CONTAINER_TTL_HOURS` env var was removed in migration 006.

> **Authentication:** v0.4.0 introduces mandatory auth. On first run, the setup wizard requires a username and password before the dashboard is accessible. Credentials are bcrypt-hashed and stored in `AppSetting`. Sessions use a signed httpOnly cookie via `itsdangerous`. A `RESET_ADMIN_PASSWORD=true` env var clears credentials and re-triggers the wizard. An "auth_mode = none" escape hatch is available for users behind an external auth proxy.

**Never commit `.env`.** It is in `.gitignore`. It may contain a Discord webhook URL.

---

## API Endpoints

All endpoints are prefixed `/api/`. See `backend/api/` for route definitions.


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
3. Do not open or update a PR. A separate prompt handles PR creation when the work is ready to merge.

Never push directly to `main`. All work happens on `dev` and goes to `main` via PR.

---

## Common Pitfalls

- **Schema changes** require a new entry in `backend/migrations.py`. Add the column to the model as `Optional` with a default, then append a `(version_str, fn)` tuple to `MIGRATIONS`. Do not drop the volume — migrations run at startup and apply the change in place.
- **Empty collector batch** — `_apply_batch()` in `services/collector.py` has a guard: if `seen_ids` is empty, reconciliation is skipped to avoid wiping the table when Docker is temporarily unreachable.
- **`die` vs `crash`** — the collector maps `die` + non-zero exit to `crash`, but both share the `crash` alert setting. Don't add a separate `die` setting without updating `_SETTING_KEY` in both `events.py` and `services/collector.py`.
- **Single writable Docker socket mount** — the socket is mounted writable for both container actions and the in-process collector stats polling.
- **macOS/Colima/OrbStack** all expose the socket at `/var/run/docker.sock` — no config changes needed. Only non-standard socket paths require updating the volume mount in `docker-compose.yml`.
- **Collector writes directly to DB** — there are no HTTP endpoints for collector ingest. The collector runs in-process and uses SQLModel sessions directly.
- **`RESET_ADMIN_PASSWORD` must be removed after use** — leaving it set means every restart clears credentials. Document this clearly when advising users.

## Validation

Claude Code should not run validation commands as part of task completion — it does not have access to the Docker build environment, and lightweight checks like `curl` may unintentionally hit the live local stack.

Validation is always performed manually by the developer. The chat session that generated the implementation prompt will provide a validation checklist alongside the prompt.

---

## Prompt Generation Guidelines

When generating implementation prompts for phases, fixes, or features:

- Describe **intent and constraints**, not implementation details
- Reference relevant files or modules for context, but do not pre-write code
- Include clear acceptance criteria (what "done" looks like)
- Define explicit scope boundaries (what is out of scope for this prompt)
- Reserve code blocks only for values that must be exact: env var names, API route paths, config keys, specific error messages
- Let Claude Code read the repo and make locally-coherent implementation decisions based on existing patterns and CLAUDE.md conventions
- Do not include validation steps in the prompt — the chat session that generated the prompt will provide a validation checklist separately

The goal is a prompt that reads like a senior eng handing off a ticket — specific enough to prevent wandering, open enough to allow good local judgment.