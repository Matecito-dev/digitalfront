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

Esto genera `app-www/` (Phaser local, sin CDN, con auth-ui/session-boot/game-loader/game-core), verifica assets y sincroniza con `client/android/`.

## 3. Primera ejecución en dispositivo

```bash
npm run cap:run:android
```

O abre Android Studio:

```bash
npm run cap:android
```

**Primera vez (sin `DF_SERVER_URL` en build):** la app muestra **Ajustes del servidor**. Introduce `http://100.x.y.z:3333`, pulsa **Probar conexión** y **Guardar y continuar**.

Luego: login guest o OAuth (X/GitHub) → mapa en **horizontal** → tap campamento o botón 🏕 → salir del refugio → jugar.

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

- Pantalla **Ajustes del servidor** solo en Capacitor nativo, cuando no hay `df_api_base` ni `DF_CONFIG.apiBase`.
- URL guardada en `localStorage` (`df_api_base`).
- No se usa `server.url` fijo en `capacitor.config.ts` — flexible para Tailscale.

## OAuth X / GitHub en APK

El flujo OAuth usa **Capacitor Browser** + **App Links** con redirect fijo a `https://play.gamedevforge.com/auth/x/callback` (o `/auth/github/callback`).

1. Registrar esas URIs en las consolas de **X** y **GitHub** (si no están ya).
2. Publicar **Digital Asset Links** en `https://play.gamedevforge.com/.well-known/assetlinks.json` con el SHA-256 del certificado de firma del APK.
3. Obtener SHA debug:
   ```bash
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android | grep SHA256
   ```
4. Tras cambiar `assetlinks.json`, reinstalar la APK y verificar:
   ```bash
   adb shell am start -a android.intent.action.VIEW -d "https://play.gamedevforge.com/auth/x/callback?code=test"
   ```

Fallback: si App Link falla, `app-www/auth/x/callback/index.html` procesa el código y redirige al inicio.

## Troubleshooting

| Problema | Solución |
|----------|----------|
| Pantalla blanca | Verifica `npm run app:verify` — Phaser debe estar en `app-www/vendor/` |
| Login sin botones OAuth | Rebuild: `npm run cap:sync` — deben existir `auth-ui.js`, `session-boot.js`, `game-loader.js` |
| OAuth X error redirect | En APK nunca usa `localhost`; debe volver vía App Link a `play.gamedevforge.com` |
| HTTP bloqueado | `AndroidManifest.xml` tiene `usesCleartextTraffic="true"` |
| WS desconectado | Revisa URL en Ajustes; PC accesible desde el teléfono (`curl http://100.x.y.z:3333/api/profile/me`) |
| Login no entra en landscape | Clase `capacitor-native` + CSS compacto; rebuild APK |
| Soft-lock en refugio | Botón **Salir refugio** / banner **Salir al campo** |
| Rotación | Bloqueada a landscape vía plugin ScreenOrientation |

## QA en dispositivo (checklist)

- [ ] App abre sin pantalla blanca
- [ ] Login entra en pantalla landscape (sin scroll excesivo)
- [ ] Ajustes: guardar URL Tailscale y conectar
- [ ] Login guest funciona
- [ ] OAuth X → sesión OK → entrar al mundo
- [ ] OAuth GitHub → idem
- [ ] Mapa carga tiles
- [ ] Tap campamento o botón 🏕 abre modal / sale del refugio
- [ ] Long-press emite orden de movimiento
- [ ] Pinch zoom
- [ ] Chat (drawer 💬)
- [ ] Botón Atrás cierra modales
- [ ] Rotación bloqueada a landscape

**Estado:** pipeline build/sync verificado en CI local; QA en dispositivo real pendiente de ejecución manual.
