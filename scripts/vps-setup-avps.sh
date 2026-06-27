#!/bin/bash
# Bootstrap infra Digital Front en VPS: /srv/avps, PostgreSQL, Redis, systemd, Caddy
# Uso: bash scripts/vps-setup-avps.sh
set -euo pipefail

VPS_HOST="${VPS_HOST:-ubuntu@192.99.54.33}"
SLUG="avps"
DB="velis"
PG_USER="velis_app"
PORT="${AVPS_PORT:-3009}"
DOMAIN="${AVPS_DOMAIN:-api.gamedevforge.com}"

ssh -o ConnectTimeout=15 "${VPS_HOST}" bash -s <<REMOTE
set -euo pipefail
SLUG="${SLUG}"
DB="${DB}"
PG_USER="${PG_USER}"
PORT="${PORT}"
DOMAIN="${DOMAIN}"
SECRETS="/root/.vps-secrets/pg.env"

echo "=== Redis (localhost) ==="
if ! command -v redis-server >/dev/null; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq redis-server
fi
sudo sed -i 's/^supervised no/supervised systemd/' /etc/redis/redis.conf 2>/dev/null || true
sudo sed -i 's/^#* bind .*/bind 127.0.0.1 -::1/' /etc/redis/redis.conf
sudo systemctl enable --now redis-server
redis-cli ping

echo "=== PostgreSQL DB \${DB} ==="
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='\${PG_USER}'" | grep -q 1; then
  PASS=\$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
  sudo -u postgres psql <<SQL
CREATE ROLE \${PG_USER} WITH LOGIN PASSWORD '\${PASS}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE \${DB} OWNER \${PG_USER};
REVOKE ALL ON DATABASE \${DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE \${DB} TO \${PG_USER};
SQL
  sudo -u postgres psql -d "\${DB}" <<SQL
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO \${PG_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO \${PG_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO \${PG_USER};
SQL
  sudo mkdir -p /root/.vps-secrets
  echo "\${DB}_DATABASE_URL=postgresql://\${PG_USER}:\${PASS}@127.0.0.1:5432/\${DB}" | sudo tee -a "\${SECRETS}"
fi

DB_URL=\$(sudo grep "^\${DB}_DATABASE_URL=" "\${SECRETS}" | tail -1 | cut -d= -f2-)

echo "=== Usuario Linux svc-\${SLUG} ==="
if ! id "svc-\${SLUG}" &>/dev/null; then
  sudo useradd --system --home /srv/\${SLUG} --shell /usr/sbin/nologin svc-\${SLUG}
fi
sudo mkdir -p /srv/\${SLUG}/{current,releases,shared,apk}
sudo chown -R svc-\${SLUG}:svc-\${SLUG} /srv/\${SLUG}
sudo chmod 750 /srv/\${SLUG}

sudo tee /srv/\${SLUG}/.env >/dev/null <<EOF
HOST=127.0.0.1
PORT=\${PORT}
NODE_ENV=production
DATABASE_URL=\${DB_URL}
REDIS_URL=redis://127.0.0.1:6379
DF_MAX_PLAYERS=100
DF_SHARD_ID=valle-bruma
DF_SESSION_TTL_DAYS=30
DF_TILE_CACHE=/srv/avps/shared/tile-cache
EOF
sudo mkdir -p /srv/\${SLUG}/shared/tile-cache
sudo chown -R svc-\${SLUG}:svc-\${SLUG} /srv/\${SLUG}/shared
sudo chown svc-\${SLUG}:svc-\${SLUG} /srv/\${SLUG}/.env
sudo chmod 600 /srv/\${SLUG}/.env

echo "=== systemd \${SLUG}.service ==="
sudo tee /etc/systemd/system/\${SLUG}.service >/dev/null <<'UNIT'
[Unit]
Description=Digital Front MMORTS
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=svc-avps
Group=svc-avps
WorkingDirectory=/srv/avps/current
EnvironmentFile=/srv/avps/.env
ExecStart=/usr/bin/node dist/scripts/viewer-server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/avps
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable \${SLUG}

echo "=== Caddy \${DOMAIN} ==="
CADDY_BLOCK="
\${DOMAIN} {
    reverse_proxy 127.0.0.1:\${PORT}
    handle /apk/* {
        root * /srv/\${SLUG}/apk
        file_server
    }
}
"
if ! sudo grep -q "\${DOMAIN}" /etc/caddy/Caddyfile 2>/dev/null; then
  echo "\${CADDY_BLOCK}" | sudo tee -a /etc/caddy/Caddyfile
  sudo sed -i 's/^:80 {/# :80 disabled — apps deployed\n# :80 {/' /etc/caddy/Caddyfile || true
  sudo systemctl reload caddy || sudo systemctl restart caddy
fi

echo "=== Infra avps OK ==="
REMOTE

echo "✓ Infra VPS lista. Ejecutá: bash scripts/deploy-vps.sh"
