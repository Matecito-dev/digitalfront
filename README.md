# digitalfront

**Digital Front** — MMORTS táctico en mapa procedural (Phaser 3 + Node/WS). Módulo de generación de mundo extraído de [etheria](../etheria).

## Estructura

```
src/
  worldgen/          ← NÚCLEO PORTABLE (compila y corre sin etheria)
    voronoiGraph.ts
    voronoiHeightmap.ts
    azgaarHeightmap.ts
    worldTerrainGenerator.ts
    worldTerrainConfigData.ts
    worldTerrainMask.ts
    worldConfigData.ts
    worldZoneConfigData.ts
    worldPOIs.ts
    worldRegions.ts
    __tests__/
    integration/     ← acoplado a prisma/matecito/etheria (referencia)
      worldConfig.ts, worldService.ts, worldActions.ts,
      worldTerrainRuntime.ts, worldTerrainRepair.ts

  cities/            ← NIVEL MAPA (portable)
    cityBaseConfig.ts
    integration/     ← acoplado a prisma/matecito (referencia)
      cityCreation.ts, cityPower.ts

  barbarians/        ← CONFIG PORTABLE
    barbarianConfigData.ts
    barbarianAttackConfigData.ts
    barbarianRewardConfigData.ts
    integration/     ← acoplado a prisma/matecito (referencia)
      barbarians.ts, barbarianAI.ts, barbarianAttacks.ts,
      barbarianSpawnWorker.ts, barbarianSpawnCron.ts

  server/            ← rutas hono (incompletas, referencia)
    world.ts

  frontend/          ← UI PixiJS (acoplada a Next.js/@/ paths, referencia)
    worldmap/, barbarians/, pages/, api/

  shared/            ← tipos portables (extraídos de @etheria/shared)
    world.ts         # Season, WorldZone, WorldRegion, WorldPOI
    barbarians.ts    # BarbarianArchetype, BarbarianCamp, ResourceRange

scripts/
  generate-world.ts  ← demo standalone

assets/              ← imágenes del mapa (webp/png)
out/                 ← salida del demo (gitignored)
```

**Regla:** todo lo que está dentro de `integration/`, `server/` o `frontend/` tiene dependencias hacia etheria y NO forma parte del build del núcleo.

## Comandos

### Jugar (un solo comando)

```bash
npm install
npm run dev      # servidor + juego Phaser → http://localhost:3333
```

**Motor:** Phaser 3 (`viewer/index.html`) — fog, combate, touch, WS. **Pixi no es el juego.**

Perfiles de rendimiento (auto o `?profile=`):

| Perfil | Cuándo | FPS | Tiles HD máx |
|--------|--------|-----|--------------|
| `desktop` | PC | 60 | 220 (adaptativo) |
| `mobile` | Android / touch | 30 | 64 |
| `low` | PC lento | 24 | 40 |

Alias: `npm run viewer` · `npm run start`

### Android

```bash
npm run app:build   # viewer Phaser → app-www/
npm run cap:sync
npm run cap:android
```

Ver `android/README.md`.

### Desarrollo del núcleo

```bash
npm run build    # compila el núcleo portable (src/worldgen + src/shared + scripts)
npm test         # corre los tests del núcleo
npm run gen      # genera out/world-42.png + out/world-42.json (demo)
npm run gen 123  # mismo demo con seed distinto
```

### Lab Pixi (opcional — solo mapa, sin gameplay)

```bash
npm run lab:pixi   # :5174 — requiere npm run dev (:3333). Usar ?lab=1 para forzar.
```

Service Worker (`tile-sw.js`) cachea tiles WebP cache-first.

## Contrato de re-integración

### worldgen/integration/

Espera de etheria:
- **`@etheria/database`** → `prisma` (PrismaClient) — modelos: `world`, `city`, `barbarianCamp`, `barbarianArmy`, `barbarianMove`
- **`@etheria/shared`** → tipos: `WorldMovement`, `WorldSeasonState`, `UnitType`
- **`../infrastructure/matecito.js`** → `db`, `COLLECTIONS` (CITIES, BARBARIAN_CAMPS, BARBARIAN_ARMIES, WORLD_SEASON_STATE)
- Módulos no copiados aún: `terrainRender.ts`, `terrainTileStore.ts`, `tileRenderPool.js`

### cities/integration/

Espera de etheria:
- **`@etheria/database`** → `prisma` — modelos: `city`, `building`, `cityUnit`
- **`@etheria/shared`** → tipos: `UnitType`, `TechBonuses`
- **`../infrastructure/matecito.js`** → `db`, `COLLECTIONS`
- Módulos no copiados: `units.ts`, `techs.ts`, `nameGenerator.ts`, `raceConfigData.ts`

### barbarians/integration/

Espera de etheria:
- **`@etheria/database`** → `prisma` — modelos: `barbarianCamp`, `barbarianArmy`, `barbarianBattle`, `barbarianAttack`, `barbarianMove`, `barbarianDuel`, `barbarianCampTrade`
- **`../infrastructure/matecito.js`** → `db`, `COLLECTIONS`
- **`../infrastructure/activityFeed.js`** → feed de actividad
- Módulos no copiados: `seasons.ts`, `battles.ts`, `units.ts`

### server/world.ts

Espera adicionalmente: `hono`, `@hono/zod-validator`, `zod`, plus todos los módulos de `integration/` y sus dependencias. Módulos no copiados: `scouting.ts`, `winterPressure.ts`, `production.ts`, `seasonConfigData.ts`, `terrainRender.ts`, `terrainTileStore.ts`, `tileRenderPool.js`.

### frontend/

Espera: `next@15`, `react@19`, `pixi.js@8`, `pixi-viewport@6`, `zustand@5`, `@tanstack/react-query@5`.
Path alias `@/` → `apps/web/src/` en etheria:
- `@/i18n` → hook de internacionalización
- `@/hooks/useIsMobile` → detección mobile
- `@/hooks/useBarbarianAttackAlerts`, `useWorlds`, `useMatecitoAuth` → react-query hooks
- `@/stores/gameStore` → zustand store
