# Android (Capacitor + Phaser)

La app Android empaqueta el **viewer Phaser** (`viewer/index.html`), no el lab Pixi.

## Build web + sync

Desde `worldgen/`:

```bash
npm run app:build    # copia viewer → app-www/
npm run cap:sync     # app:build + cap sync
npm run cap:android  # abre Android Studio
```

Primera vez:

```bash
cd client && npx cap add android
```

## Servidor de juego

El WebView necesita la API (`/api/world`, tiles, sim WS). Opciones:

1. **Producción:** desplegar `npm run dev` (viewer-server) y en `client/capacitor.config.ts` añadir `server.url` apuntando a tu host.
2. **Dev en red local:** `server.url: "http://192.168.x.x:3333"` (misma WiFi que el PC).

Perfil móvil automático en Android (`Capacitor.getPlatform() === 'android'` → 30 fps, menos tiles).

Forzar perfil: `?profile=low|mobile|desktop`
