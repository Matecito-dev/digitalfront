#!/bin/bash
# Configura Caddy + .env en VPS para gamedevforge.com
# DNS (Cloudflare): A api → IP del VPS | CNAME play → Vercel
set -euo pipefail

VPS_IP="${VPS_IP:-192.99.54.33}"
VPS_USER="${VPS_USER:-ubuntu}"
VPS_HOST="${VPS_HOST:-${VPS_USER}@${VPS_IP}}"
API_DOMAIN="${API_DOMAIN:-api.gamedevforge.com}"
PLAY_DOMAIN="${PLAY_DOMAIN:-play.gamedevforge.com}"
PORT="${AVPS_PORT:-3009}"
SLUG="avps"
# Orígenes permitidos (frontend Vercel + apex)
CORS_ORIGINS="https://${PLAY_DOMAIN},https://gamedevforge.com,https://www.gamedevforge.com"

echo "→ Configurando ${API_DOMAIN} en ${VPS_HOST} (IP ${VPS_IP})"

ssh -o ConnectTimeout=15 "${VPS_HOST}" bash -s <<REMOTE
set -euo pipefail
API_DOMAIN="${API_DOMAIN}"
VPS_IP="${VPS_IP}"
PORT="${PORT}"
SLUG="${SLUG}"
CORS_ORIGINS="${CORS_ORIGINS}"
ENV_FILE="/srv/\${SLUG}/.env"
CADDY="/etc/caddy/Caddyfile"

# --- Caddy: bloque API ---
if ! sudo grep -q "\${API_DOMAIN}" "\${CADDY}" 2>/dev/null; then
  sudo tee -a "\${CADDY}" >/dev/null <<CADDYBLOCK

# Digital Front API — gamedevforge.com
\${API_DOMAIN} {
    reverse_proxy 127.0.0.1:\${PORT}
    handle /apk/* {
        root * /srv/\${SLUG}/apk
        file_server
    }
}
CADDYBLOCK
  echo "✓ Caddy: añadido \${API_DOMAIN}"
else
  echo "• Caddy: \${API_DOMAIN} ya existe"
fi

# Acceso por IP (legacy / debug)
if ! sudo grep -q "http://\${VPS_IP}" "\${CADDY}" 2>/dev/null; then
  sudo tee -a "\${CADDY}" >/dev/null <<IPBLOCK

http://\${VPS_IP} {
    reverse_proxy 127.0.0.1:\${PORT}
    handle /apk/* {
        root * /srv/\${SLUG}/apk
        file_server
    }
}
IPBLOCK
  echo "✓ Caddy: bloque IP legacy (\${VPS_IP})"
fi

sudo caddy validate --config "\${CADDY}"
sudo systemctl reload caddy || sudo systemctl restart caddy

# --- .env: CORS + API-only en prod ---
upsert_env() {
  local key="\$1" val="\$2"
  if sudo grep -q "^\${key}=" "\${ENV_FILE}" 2>/dev/null; then
    sudo sed -i "s|^\${key}=.*|\${key}=\${val}|" "\${ENV_FILE}"
  else
    echo "\${key}=\${val}" | sudo tee -a "\${ENV_FILE}" >/dev/null
  fi
}

upsert_env DF_CORS_ORIGINS "\${CORS_ORIGINS}"
upsert_env NODE_ENV production
upsert_env DF_API_ONLY 1

sudo systemctl restart \${SLUG}
sleep 2
sudo systemctl is-active \${SLUG}
REMOTE

echo ""
echo "✓ VPS listo para ${API_DOMAIN}"
echo ""
echo "Cloudflare (recomendado al inicio — nube gris / DNS only):"
echo "  A    api   → ${VPS_IP}"
echo ""
echo "Override de host: VPS_IP=1.2.3.4 bash scripts/configure-gamedevforge-vps.sh"
echo "  (o VPS_HOST=user@host si necesitás usuario distinto de ubuntu)"
echo "Vercel:"
echo "  CNAME play → cname.vercel-dns.com  (o dominio custom en proyecto)"
echo "  Env: DF_API_URL=https://${API_DOMAIN}"
echo ""
echo "Probar tras DNS:"
echo "  curl https://${API_DOMAIN}/api/health"
