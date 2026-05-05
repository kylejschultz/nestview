<div align="center">

<img src="landing/assets/nestview-wordmark.svg" alt="Nestview" width="320"><br><br>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/kylejschultz?label=Sponsor&logo=githubsponsors&color=ea4aaa)](https://github.com/sponsors/kylejschultz)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support%20the%20project-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/kylejschultz)
[![Discord](https://img.shields.io/badge/Discord-join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/TfQ8QX3Ptr)

</div>

**Lightweight, self-hosted Docker visibility for homelabbers.**

Nestview gives you a live health dashboard, searchable log history, and Discord alerts for all your containers - no manual configuration, no Grafana stack required. Point it at your Docker socket and it discovers everything automatically.

> **Need help?** [Join the Discord](https://discord.gg/TfQ8QX3Ptr) - it's the fastest way to get support, ask questions, or report a bug. GitHub Issues is available too, but Discord is where the conversation happens.

## Quick start
### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) installed and running
- [Docker Compose](https://docs.docker.com/compose/install/) *(Optional)*
- [Unraid Community Apps Plugin](https://docs.unraid.net/unraid-os/using-unraid-to/run-docker-containers/community-applications/#installing-the-plugin) *(Optional) - if using on an Unraid server.*

### Installation:
#### Docker Compose (Recommended):

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
```
To update, pull the latest image and restart:
```bash
docker compose pull
docker compose up -d
```

#### Docker Standalone
  To run it directly without a compose file:
  ```bash
  docker run -d \
    --name nestview \
    --restart unless-stopped \
    -p 8484:8080 \
    -v $(pwd)/data:/data \
    -v /var/run/docker.sock:/var/run/docker.sock \
    ghcr.io/kylejschultz/nestview:latest
  ```

#### Unraid Community Applications
Search for **Nestview** in the Unraid CA plugin. The template is pre-configured with everything you should need. All Environmental Variables are included in the template, with optional variables found by clicking **Show more settings...**

The Unraid support thread can be found on the [Unraid forums](https://forums.unraid.net/topic/198374-support-nestview-lightweight-docker-observability/).

## Security
On first launch, you'll be prompted to create an admin username and password before the dashboard is accessible.

**If you use an external auth proxy** (Authelia, Authentik, nginx basic auth), you can select "No authentication" during setup to avoid double-authenticating. Only use this option if Nestview is not directly accessible from outside your network.

**If you forget your password**, add `RESET_ADMIN_PASSWORD=true` to your `.env` file and restart the container. You'll be taken back through the setup wizard. Remove the variable and restart again once you've set a new password.

**If you need to access Nestview remotely**, put it behind a VPN (Tailscale, WireGuard) rather than port-forwarding directly. Do not expose port 8484 to the internet.

## Environment variables
> The below envs are optional and most can be configured in the UI - only set if needed.
> - **Docker Users:** Copy `.env.example` to `.env`
> - **Unraid Users:** These are hidden by default. Click **Show more settings...** to unhide and set as needed.

| Variable | Default | Description |
|---|---|---|
| `NESTVIEW_PORT` | `8484` | Host port Nestview is exposed on |
| `POLL_INTERVAL` | `10` | Seconds between Docker stats polls |
| `LOG_BATCH_INTERVAL` | `5` | Seconds between log flushes to SQLite |
| `SECRET_KEY` | _(auto-generated)_ | Session cookie signing key. Leave blank - Nestview generates and persists one automatically. Set explicitly for scripted deployments that need stable sessions across data resets. |
| `RESET_ADMIN_PASSWORD` | _(unset)_ | Set to `true` to clear stored credentials and re-trigger the setup wizard on next start. Remove after completing setup. |
| `NESTVIEW_SECURE_COOKIES` | `false` | Set to `true` when Nestview is behind a TLS-terminating reverse proxy (Nginx, Caddy, Traefik). Marks session cookies as `Secure` so they are only sent over HTTPS. |
| `DATABASE_PATH` | `/data/nestview.db` | Path inside the container where Nestview stores its SQLite database. Override only if you need a non-standard mount path. |
| `TZ` | `UTC` | Timezone for log timestamps and scheduled tasks. Use a standard tz database name (e.g. `America/Chicago`, `Europe/London`). |
| `LOG_RETENTION_DAYS` | `7` | How many days of container log history to keep. Seeded from this env var on first run only; changes after initial setup must be made in the Settings UI. |

Log retention and exited container TTL are configured in the Settings UI.

## Discord alerts
1. In your Discord server, Create a new channel for notifications.
2. Select the channel and go to **Edit Channel > Integrations > Create Webhook**
3. Copy the webhook URL
4. Open Nestview and paste the URL into the setup wizard (shown on first launch) or **Settings > General**

Nestview sends a formatted embed when a container crashes (non-zero exit), is OOM-killed, or restarts unexpectedly.

## License
[GNU General Public License v3.0](./LICENSE) - free to use, modify, and self-host. If you distribute modified versions, you must release them under the same license.

## Community & support
**Discord is the best place to get help.** Join at [discord.gg/TfQ8QX3Ptr](https://discord.gg/TfQ8QX3Ptr) - bug reports, questions, and general chat all happen there.

[GitHub Issues](https://github.com/kylejschultz/nestview/issues) is available for bugs and feature requests, but Discord is faster and more conversational. Please search existing issues before opening a new one.

[GitHub Sponsors](https://github.com/sponsors/kylejschultz) / [Ko-fi](https://ko-fi.com/kylejschultz) - if Nestview saves you time, a coffee is always appreciated.

## Contributing
See [CONTRIBUTING.md](./CONTRIBUTING.md). TL;DR: open an issue before big changes, follow conventional commits, don't be a dick.