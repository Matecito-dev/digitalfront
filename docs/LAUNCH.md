# Guía de lanzamiento — Digital Front (gamedevforge.com)

Deploy split:

| Rol | Dominio | Hosting |
|-----|---------|---------|
| Frontend (juego) | `https://play.gamedevforge.com` | Vercel |
| Backend (API + WS + tiles) | `https://api.gamedevforge.com` | VPS + Caddy |

## DNS (Cloudflare)

| Registro | Tipo | Valor | Proxy |
|----------|------|-------|-------|
| `api` | **A** | `192.99.54.33` | **DNS only (gris)** al inicio |
| `play` | **CNAME** | `cname.vercel-dns.com` | Según Vercel |

Configurar VPS una vez:

```bash
bash scripts/configure-gamedevforge-vps.sh
```

## Vercel

1. Proyecto conectado al repo.
2. **Build:** `npm run build:web` · **Output:** `web` (ver `vercel.json`).
3. Dominio custom: `play.gamedevforge.com`.
4. Variable de entorno:

   | Variable | Valor |
   |----------|-------|
   | `DF_API_URL` | `https://api.gamedevforge.com` |

## Build local

```bash
DF_API_URL=https://api.gamedevforge.com npm run build:web
```

## APK Android

```bash
DF_SERVER_URL=https://api.gamedevforge.com npm run cap:sync
cd client/android && ./gradlew assembleDebug
```

APK en VPS: `https://api.gamedevforge.com/apk/app-debug.apk`

## Checklist

- [ ] `curl https://api.gamedevforge.com/api/health` → `{ "ok": true, ... }`
- [ ] `play.gamedevforge.com` carga login y conecta `wss://api.gamedevforge.com/api/sim/ws`
- [ ] CORS: `DF_CORS_ORIGINS` en VPS incluye `https://play.gamedevforge.com`
- [ ] OG card en [Twitter Card Validator](https://cards-dev.twitter.com/validator)

## Troubleshooting

| Síntoma | Solución |
|---------|----------|
| Mixed content | Frontend debe ser HTTPS; API en `https://api.gamedevforge.com` |
| WS falla con proxy naranja | Cloudflare → WebSockets ON; SSL Full; o usar DNS gris en `api` |
| CORS error | Añadir origen Vercel a `DF_CORS_ORIGINS` y `systemctl restart avps` |

**Nota:** el servidor acepta también variables legacy `VELIS_*` por compatibilidad con deploys anteriores.
