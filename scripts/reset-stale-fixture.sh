#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${STALE_FIXTURE_COMPOSE:-/Users/server/.openclaw/workspace/nestview-stale-test/docker-compose.yml}"
SERVICE="${STALE_FIXTURE_SERVICE:-stale-web}"
IMAGE_REF="${STALE_FIXTURE_IMAGE:-nginx:alpine}"
OLD_DIGEST="${STALE_FIXTURE_OLD_DIGEST:-nginx@sha256:7150b3a39203cb5bee612ff4a9d18774f8c7caf6399d6e8985e97e28eb751c18}"
NESTVIEW_CONTAINER="${NESTVIEW_CONTAINER:-nestview}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Fixture compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

docker pull "$OLD_DIGEST" >/dev/null
old_image_id="$(docker image inspect "$OLD_DIGEST" --format '{{.Id}}')"

docker tag "$old_image_id" "$IMAGE_REF"
docker compose -f "$COMPOSE_FILE" up -d --force-recreate "$SERVICE"

if docker ps --format '{{.Names}}' | grep -qx "$NESTVIEW_CONTAINER"; then
  docker exec "$NESTVIEW_CONTAINER" python -c 'from services.image_checker import run_image_check; run_image_check()'
fi

echo "Reset stale fixture:"
docker inspect nestview-stale-web --format '  container={{.Name}} image={{.Config.Image}} image_id={{.Image}} status={{.State.Status}}'
docker image inspect "$IMAGE_REF" --format '  local_tag={{.RepoTags}} image_id={{.Id}} repo_digests={{json .RepoDigests}}'
