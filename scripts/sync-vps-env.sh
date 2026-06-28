#!/usr/bin/env bash
# Sincroniza claves de .env local → /srv/avps/.env en el VPS (sin imprimir secretos).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VPS_IP="${VPS_IP:-192.99.54.33}"
VPS_USER="${VPS_USER:-ubuntu}"
VPS_HOST="${VPS_HOST:-${VPS_USER}@${VPS_IP}}"
SLUG="avps"
ENV_FILE="/srv/${SLUG}/.env"
LOCAL_ENV="${ROOT}/.env"

if [[ ! -f "${LOCAL_ENV}" ]]; then
  echo "Falta ${LOCAL_ENV} — copiá desde .env.example y completá secretos."
  exit 1
fi

# Claves que el backend necesita en prod (OAuth + CORS + flags)
KEYS=(
  GITHUB_CLIENT_ID
  GITHUB_CLIENT_SECRET
  GITHUB_REDIRECT_URI
  X_CLIENT_ID
  X_CLIENT_SECRET
  X_REDIRECT_URI
  DF_CORS_ORIGINS
  DF_API_ONLY
  NODE_ENV
)

TMP="$(mktemp)"
trap 'rm -f "${TMP}"' EXIT

for key in "${KEYS[@]}"; do
  line="$(grep -E "^${key}=" "${LOCAL_ENV}" 2>/dev/null | tail -1 || true)"
  [[ -n "${line}" ]] || continue
  val="${line#*=}"
  # No subir placeholders vacíos
  if [[ "${val}" == *"_here" ]] || [[ -z "${val}" ]] || [[ "${val}" == your_* ]]; then
    echo "• omitido ${key} (placeholder o vacío)"
    # Quitar placeholders viejos del VPS para no servir client_id inválidos
    ssh -o ConnectTimeout=15 "${VPS_HOST}" "sudo sed -i '/^${key}=/d' ${ENV_FILE} 2>/dev/null || true"
    continue
  fi
  printf '%s=%s\n' "${key}" "${val}" >> "${TMP}"
done

if [[ ! -s "${TMP}" ]]; then
  echo "Nada que sincronizar — completá OAuth/CORS en .env local."
  exit 0
fi

echo "→ Sincronizando $(wc -l < "${TMP}") claves → ${VPS_HOST}:${ENV_FILE}"

ssh -o ConnectTimeout=15 "${VPS_HOST}" "sudo test -f ${ENV_FILE}" || {
  echo "No existe ${ENV_FILE}. Ejecutá primero scripts/vps-setup-avps.sh"
  exit 1
}

while IFS= read -r line; do
  key="${line%%=*}"
  val="${line#*=}"
  ssh -o ConnectTimeout=15 "${VPS_HOST}" bash -s <<REMOTE
set -euo pipefail
key="${key}"
val="${val}"
file="${ENV_FILE}"
if sudo grep -q "^\${key}=" "\${file}" 2>/dev/null; then
  sudo sed -i "s|^\${key}=.*|\${key}=\${val}|" "\${file}"
else
  echo "\${key}=\${val}" | sudo tee -a "\${file}" >/dev/null
fi
REMOTE
  echo "✓ ${key}"
done < "${TMP}"

ssh -o ConnectTimeout=15 "${VPS_HOST}" "sudo systemctl restart ${SLUG} && sleep 2 && sudo systemctl is-active ${SLUG}"
echo "✓ .env VPS actualizado y servicio reiniciado"
