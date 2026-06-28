#!/bin/bash
# Deploy Digital Front → VPS /srv/avps — api.gamedevforge.com
# Override: VPS_IP=1.2.3.4 bash scripts/deploy-vps.sh  (default IP 192.99.54.33)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VPS_IP="${VPS_IP:-192.99.54.33}"
VPS_USER="${VPS_USER:-ubuntu}"
VPS_HOST="${VPS_HOST:-${VPS_USER}@${VPS_IP}}"
SLUG="avps"
PORT="${AVPS_PORT:-3009}"
DOMAIN="${AVPS_DOMAIN:-api.gamedevforge.com}"
REMOTE_DIR="/srv/${SLUG}/current"

echo "→ Deploy Digital Front → ${VPS_HOST}:${REMOTE_DIR} (${DOMAIN}:${PORT})"

STAGING="/tmp/${SLUG}-deploy-$$"
ssh -o ConnectTimeout=15 "${VPS_HOST}" "rm -rf ${STAGING} && mkdir -p ${STAGING}"

rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .tile-cache \
  --exclude client/node_modules \
  --exclude client/android/.gradle \
  --exclude client/android/app/build \
  --exclude app-www \
  --exclude out \
  --exclude dist \
  "${ROOT}/" "${VPS_HOST}:${STAGING}/"

ssh -o ConnectTimeout=15 "${VPS_HOST}" bash -s <<REMOTE
set -euo pipefail
cd ${STAGING}
# Build sin NODE_ENV=production para incluir devDependencies (typescript)
npm ci
npm run build
set -a
source <(sudo cat /srv/${SLUG}/.env)
set +a
npm run db:migrate
# Permisos temporales para deploy (svc-avps no puede leer /srv/avps entre deploys)
sudo chown -R "\$(whoami):\$(whoami)" "/srv/${SLUG}/shared"
TILE_CACHE="/srv/${SLUG}/shared/tile-cache"
sudo mkdir -p "\${TILE_CACHE}"
CACHE_SEEDS=\$(sudo find "\${TILE_CACHE}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
if [ "\${CACHE_SEEDS}" -gt 0 ]; then
  echo "Tile cache OK (\${CACHE_SEEDS} seeds) — skip gen"
else
  echo "WARN: tile cache vacío — ejecutar gen manualmente tras deploy"
fi
sudo rsync -a --delete ${STAGING}/ ${REMOTE_DIR}/
rm -rf ${STAGING}
sudo chown -R svc-${SLUG}:svc-${SLUG} /srv/${SLUG}
sudo systemctl restart ${SLUG}
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  HEALTH_CODE=\$(curl -sf -o /dev/null -w "%{http_code}" http://127.0.0.1:${PORT}/api/health 2>/dev/null || echo "000")
  if [ "\${HEALTH_CODE}" = "200" ]; then
    echo "GET /api/health → HTTP 200 (intento \${i})"
    break
  fi
  echo "Esperando health… intento \${i}/10 (HTTP \${HEALTH_CODE})"
done
sudo systemctl is-active ${SLUG}
if [ "\${HEALTH_CODE}" != "200" ]; then
  echo "Deploy failed: /api/health did not return 200"
  exit 1
fi
REMOTE

echo "✓ Deploy listo — https://${DOMAIN} (DNS debe apuntar al VPS)"
