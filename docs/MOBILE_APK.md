# Digital Front — APK Android (Capacitor)

Guía para generar e instalar la app Android que conecta al servidor MMO en tu PC vía Tailscale o LAN.

## Prerrequisitos

- **Node.js** 20+ y npm
- **JDK 17** (Android Studio lo incluye)
- **Android Studio** con SDK Android 34+
- **Tailscale** instalado en PC y teléfono (recomendado para jugar fuera de casa)
- Servidor levantado en la PC: `npm run dev` (puerto **3333**)

## 1. Obtener la IP del servidor

En la PC donde corre el juego:

```bash
tailscale ip -4
# Ejemplo: 100.64.1.2
```

Asegúrate de que el firewall permite conexiones entrantes al puerto **3333**.

## 2. Build y sync Capacitor

Desde la raíz del repo:

```bash
# Opcional: preconfigurar URL por defecto en el APK
export DF_SERVER_URL=http://100.64.1.2:3333

npm run cap:sync
```

Esto genera `app-www/` (Phaser local, sin CDN), verifica assets y sincroniza con `client/android/`.

## 3. Primera ejecución en dispositivo

```bash
npm run cap:run:android
```

O abre Android Studio:

```bash
npm run cap:android
```

**Primera vez:** la app muestra **Ajustes del servidor**. Introduce `http://100.x.y.z:3333`, pulsa **Probar conexión** y **Guardar y continuar**.

Luego: login guest → mapa en **horizontal** → tap campamento o botón 🏕 → salir del refugio → jugar.

## 4. Generar APK debug

```bash
cd client/android
./gradlew assembleDebug
```

APK en: `client/android/app/build/outputs/apk/debug/app-debug.apk`

Instalar vía USB:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Scripts npm (raíz)

| Script | Descripción |
|--------|-------------|
| `npm run app:build` | Empaqueta viewer → `app-www/` |
| `npm run app:verify` | Verifica assets requeridos |
| `npm run cap:sync` | build + verify + cap sync |
| `npm run cap:android` | sync + abre Android Studio |
| `npm run cap:run:android` | sync + instala y ejecuta en dispositivo |

## Configuración del servidor en la app

- Pantalla **Ajustes** accesible desde login y HUD (⚙).
- URL guardada en `localStorage` (`df_api_base`).
- No se usa `server.url` fijo en `capacitor.config.ts` — flexible para Tailscale.

## Troubleshooting

| Problema | Solución |
|----------|----------|
| Pantalla blanca | Verifica `npm run app:verify` — Phaser debe estar en `app-www/vendor/` |
| HTTP bloqueado | `AndroidManifest.xml` tiene `usesCleartextTraffic="true"` |
| WS desconectado | Revisa URL en Ajustes; PC accesible desde el teléfono (`curl http://100.x.y.z:3333/api/profile/me`) |
| Soft-lock en refugio | Botón **Salir refugio** / banner **Salir al campo** |
| Rotación | Bloqueada a landscape vía plugin ScreenOrientation |

## QA en dispositivo (checklist)

- [ ] App abre sin pantalla blanca
- [ ] Ajustes: guardar URL Tailscale y conectar
- [ ] Login guest funciona
- [ ] Mapa carga tiles
- [ ] Tap campamento o botón 🏕 abre modal / sale del refugio
- [ ] Long-press emite orden de movimiento
- [ ] Pinch zoom
- [ ] Chat (drawer 💬)
- [ ] Botón Atrás cierra modales
- [ ] Rotación bloqueada a landscape

**Estado:** pipeline build/sync verificado en CI local; QA en dispositivo real pendiente de ejecución manual.
