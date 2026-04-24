<div align="center">

<img src="landing/assets/nestview-wordmark.svg" alt="Nestview" width="320"><br><br>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/kylejschultz?label=Sponsor&logo=githubsponsors&color=ea4aaa)](https://github.com/sponsors/kylejschultz)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support%20the%20project-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/kylejschultz)
[![Discord](https://img.shields.io/badge/Discord-join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/TfQ8QX3Ptr)

</div>

**Lightweight, self-hosted Docker visibility for homelabbers.**

Nestview gives you a live health dashboard, searchable log history, and Discord alerts for all your containers — no manual configuration, no Grafana stack required. Point it at your Docker socket and it discovers everything automatically.

---

## Quick start

Create a `docker-compose.yml` with the following contents:
```yaml
services:
  nestview:
    container_name: nestview
    image: ghcr.io/kylejschultz/nestview:latest
    restart: unless-stopped
    ports:
      - "${NESTVIEW_PORT:-8484}:8080"
    volumes:
      - ./data:/data
      - /var/run/docker.sock:/var/run/docker.sock
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8080/api/health')"]
      interval: 15s
      timeout: 5s
      retries: 3
```

Then run:
```bash
docker compose up -d
# Open http://localhost:8484 — complete the setup wizard to create your admin account
```

That's it. Nestview will find all running and stopped containers immediately.

```bash
# Or run directly without a compose file:
docker run -d \
  --name nestview \
  --restart unless-stopped \
  -p 8484:8080 \
  -v $(pwd)/data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/kylejschultz/nestview:latest
```

> **Data storage:** Nestview stores its SQLite database in `./data/` on your host. This directory is created automatically on first run and is safe to back up directly.
>
> **Upgrading from a named volume (pre-0.5):** If you were previously using a `nestview_data` named volume, migrate your data before starting the new version:
> ```bash
> docker run --rm -v nestview_data:/source -v $(pwd)/data:/dest alpine cp -r /source/. /dest/
> ```

---

## Updates

To pull the latest images and restart:
```bash
docker compose pull
docker compose up -d
```

---

## Security

Nestview requires authentication out of the box. On first launch, you'll be prompted to create an admin username and password before the dashboard is accessible.

**If you use an external auth proxy** (Authelia, Authentik, nginx basic auth), you can select "No authentication" during setup to avoid double-authenticating. Only use this option if Nestview is not directly accessible from outside your network.

**If you forget your password**, add `RESET_ADMIN_PASSWORD=true` to your `.env` file and restart the container. You'll be taken back through the setup wizard. Remove the variable and restart again once you've set a new password.

**If you need to access Nestview remotely**, put it behind a VPN (Tailscale, WireGuard) rather than port-forwarding directly. Do not expose port 8484 to the internet.

---

## Environment variables

> The defaults work out of the box. Copy `.env.example` to `.env` only if you want to change the port or enable Discord alerts.

| Variable | Default | Description |
|---|---|---|
| `NESTVIEW_PORT` | `8484` | Host port Nestview is exposed on |
| `POLL_INTERVAL` | `10` | Seconds between Docker stats polls |
| `LOG_BATCH_INTERVAL` | `5` | Seconds between log flushes to SQLite |
| `SECRET_KEY` | _(auto-generated)_ | Session cookie signing key. Leave blank — Nestview generates and persists one automatically. Set explicitly for scripted deployments that need stable sessions across data resets. |
| `RESET_ADMIN_PASSWORD` | _(unset)_ | Set to `true` to clear stored credentials and re-trigger the setup wizard on next start. Remove after completing setup. |
| `NESTVIEW_SECURE_COOKIES` | `false` | Set to `true` when Nestview is behind a TLS-terminating reverse proxy (Nginx, Caddy, Traefik). Marks session cookies as `Secure` so they are only sent over HTTPS. |
| `DATABASE_PATH` | `/data/nestview.db` | Path inside the container where Nestview stores its SQLite database. Override only if you need a non-standard mount path. |
| `TZ` | `UTC` | Timezone for log timestamps and scheduled tasks. Use a standard tz database name (e.g. `America/Chicago`, `Europe/London`). |
| `LOG_RETENTION_DAYS` | `7` | How many days of container log history to keep. Seeded from this env var on first run only; changes after initial setup must be made in the Settings UI. |

`POLL_INTERVAL` and `LOG_BATCH_INTERVAL` are handled inside the single container — no separate collector service required.

Log retention and exited container TTL are configured in the Settings UI.

---

## Features

- **Zero-config autodiscovery** — all containers, Compose stacks, ports, volumes, and networks detected automatically via the Docker socket
- **Live health dashboard** — per-container CPU%, memory, uptime, restart count, and status badge; containers grouped by Compose project
- **Searchable log history** — logs streamed from every running container, stored in SQLite, searchable from the UI
- **Configurable retention** — set log retention and container TTL in the Settings UI; cleanup runs hourly
- **Authentication** — mandatory login on first run; bcrypt password hashing; signed session cookies; configurable session expiry
- **Discord alerting** — get a notification when a container crashes, restarts unexpectedly, or is OOM-killed
- **Image update detection** — background job checks Docker Hub / GHCR for newer digests; sends a Discord alert when an update is available
- **Container actions** — start, stop, restart, or pull the latest image and restart any container or Compose stack directly from the dashboard
- **Image details** — container detail page shows image size and the timestamp of the last digest check

---

## What's next

- **Log intelligence** — regex pattern alerting and log bookmarks
- **Multi-host support** — connect collectors from multiple Docker hosts to a single dashboard
- **Port scan detection** — alert when a container receives traffic on an unexpected port

→ See [ROADMAP.md](./ROADMAP.md) for the full list.

---

## Discord alerts

1. In your Discord server, go to **Server Settings → Integrations → Webhooks → New Webhook**
2. Copy the webhook URL
3. Open Nestview and paste the URL into the setup wizard (shown on first launch) or **Settings → General**

Nestview sends a formatted embed when a container crashes (non-zero exit), is OOM-killed, or restarts unexpectedly.

---

## License

[GNU General Public License v3.0](./LICENSE) — free to use, modify, and self-host. If you distribute modified versions, you must release them under the same license.

## Community & support

- [Discord](https://discord.gg/TfQ8QX3Ptr) — bug reports, general chat, release announcements
- [GitHub Issues](https://github.com/kylejschultz/nestview/issues) — bugs and feature requests
- [GitHub Sponsors](https://github.com/sponsors/kylejschultz) / [Ko-fi](https://ko-fi.com/kylejschultz) — if Nestview saves you time, a coffee is always appreciated

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). TL;DR: open an issue before big changes, follow conventional commits, don't be a dick.
