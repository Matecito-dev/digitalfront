# Cursor / RAM en Linux — Digital Front

Guía para evitar que Cursor se cierre por falta de memoria al desarrollar este repo.

## Por qué pasa en Linux y no en Windows

En esta máquina (15 GB RAM) vimos:

| Proceso | RAM típica |
|---------|------------|
| Cursor (varios procesos Electron/Node) | ~2–4 GB |
| **Gradle Daemon** (Android) | **~1,5 GB cada uno** — pueden quedar **2+** activos |
| Swap llena (7,8 GB) | El sistema entra en thrashing → Cursor muere |

En Windows suele haber más RAM libre o un solo daemon Gradle; además Linux + Electron + swap agresivo empeora el colapso cuando se llena la swap.

## Acciones inmediatas

```bash
# 1. Matar daemons Gradle huérfanos (libera ~1,5 GB c/u)
pkill -f GradleDaemon
# o desde el proyecto:
cd client/android && ./gradlew --stop

# 2. Ver quién consume RAM
free -h
ps aux --sort=-%mem | head -10
```

## Builds Android sin tumbar Cursor

`client/android/gradle.properties` limita Gradle a **768 MB** y desactiva paralelismo agresivo.

Build recomendado (sin daemon persistente):

```bash
cd /home/sexs/programacion/digitalfront
DF_SERVER_URL=https://api.gamedevforge.com npm run app:build && npm run app:verify
cd client && npx cap sync
cd android
./gradlew assembleDebug --no-daemon
./gradlew --stop   # siempre después del build
```

**Mejor:** cerrar Cursor, build en terminal externa, o usar Android Studio solo para el APK.

## Tests sin spawn pesado

```bash
npm run test:smoke    # incluye cleanup automático al final
npm run test:cleanup  # mata viewer-server / vitest huérfanos de tests
```

Evitar en paralelo: `npm test` completo + Gradle + `npm run dev` + agentes Cursor en multitask.

### Limpieza automática (tests + Cursor)

- **`scripts/__tests__/testViewerServer.ts`**: spawn con `detached` + mata árbol de procesos (no deja `npx`/`tsx` vivos).
- **`vitest.config.ts`**: `globalTeardown` llama a cleanup al terminar.
- **`npm run test:cleanup`**: manual o al final de `test` / `test:mmo` / `test:smoke`.
- **`.cursor/hooks.json`**: tras `vitest` / `npm run test` y al **stop** del agente ejecuta cleanup.

Si el agente corrió tests fuera de npm (p. ej. `npx vitest` directo), el hook `stop` debería limpiar al terminar el chat.

## Ajustes Cursor (Settings)

En **Cursor → Settings** buscar y aplicar:

| Setting | Valor sugerido |
|---------|----------------|
| `files.watcherExclude` | `**/node_modules/**`, `**/client/android/**`, `**/app-www/**`, `**/.gradle/**` |
| Desactivar extensiones pesadas | ESLint en background, Docker, etc. si no los usás |
| Cerrar pestañas / chats largos | Cada agente multitask duplica contexto en RAM |

Opcional en `settings.json`:

```json
{
  "files.watcherExclude": {
    "**/node_modules/**": true,
    "**/client/android/.gradle/**": true,
    "**/client/android/build/**": true,
    "**/app-www/**": true,
    "**/dist/**": true
  }
}
```

## Servicios de fondo en esta PC

Si no los necesitás mientras desarrollás: Elasticsearch, Discord, contenedores Docker (`npm run infra:down`).

## Swap

Con 15 GB RAM, swap casi llena = sistema ya en crisis. Tras liberar Gradle, reiniciar Cursor ayuda a vaciar procesos zombie de Node.
