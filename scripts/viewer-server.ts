import { getGameVersionString, getGameVersion } from "../src/mmo/gameVersion.js";
import http from "node:http";
import zlib from "node:zlib";
import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { computeWorldMeta, type WorldMeta } from "../src/worldgen/worldMeta.js";
import type { TerrainParams } from "../src/worldgen/terrainParams.js";
import { loadUnitConfigs }    from "../src/economy/units.js";
import { loadBuildingConfigs } from "../src/economy/buildings.js";
import { loadTechConfigs }    from "../src/economy/techs.js";
import {
  generateMacroWorld, generateTile, generateOverview, TileCache,
  MACRO_COLS, MACRO_ROWS, WORLD_TILES_X, WORLD_TILES_Y, TILE_SIZE,
  type MacroWorld,
} from "../src/worldgen/tiling.js";
import { encodeTile }                                from "../src/worldgen/tileBinary.js";
import { bakeTilePngFromBin, bakeTileWebpFromBin }   from "../src/worldgen/tileImage.js";
import { renderOverviewPng }                         from "../src/worldgen/overviewImage.js";
import { encodeMacro, decodeMacro }                  from "../src/worldgen/macroCache.js";
import { hasTile, hasOverview, saveTile, saveOverview,
         loadTileGz, loadOverviewGz, cachedTileCount,
         hasOverviewPng, saveOverviewPng, loadOverviewPng, overviewPngPath,
         hasMacro, saveMacro, loadMacro,
         hasWorldMeta, saveWorldMeta, loadWorldMeta,
         hasTileWebp, hasTilePng, saveTileWebp, saveTilePng,
         loadTileWebp, loadTilePng } from "../src/worldgen/diskCache.js";
import type { WorldState, PlayerSquad } from "../src/sim/worldState.js";
import { initSeason }    from "../src/sim/seasonsMath.js";
import { mulberry32, deriveRng } from "../src/sim/rng.js";
import { tick, simDtMs } from "../src/sim/simEngine.js";
import {
  parseSeed, SeedNotAvailable, sendBin, sendJson, parseQ, sendErr, serveViewerStatic,
} from "./static-server.js";
import {
  buildTickPayload, filterGroupsForClient, computeBarbDelta, serializeBarbarianGroup,
  serializePlayerSquad, hashPlayerSquad, getOtherSquadsFromState,
  filterOtherSquadsForClient, computeOtherSquadsDelta, hashOtherSquad,
  filterMovementsForClient, filterEventsForClient, buildGroupPositionIndex,
  getClientAoiAnchor, syncClientAoiAnchor, macroDistance,
} from "./simBroadcast.js";
import { parsePlayerOrderMessage, parseCampActionMessage, parseChatSendMessage, parseSquadActionMessage } from "./playerOrders.js";
import {
  ensurePlayerSquad,
  applyPlayerOrder,
  getPlayerCentroid,
  isSquadAlive,
  unstuckPlayerSquad,
  countStuckUnits,
  UNSTUCK_COOLDOWN_MS,
} from "../src/sim/playerSquad.js";
import { canInitiatePvp } from "../src/sim/playerVsPlayer.js";
import { initDb } from "../src/mmo/db.js";
import { initRedis } from "../src/mmo/redis.js";
import { refreshOnlinePresence, validateSessionToken, clearOnlinePresence } from "../src/mmo/session.js";
import { pickSpawnOutpost } from "../src/mmo/spawn.js";
import { generateOutposts } from "../src/sim/outpostCamp.js";
import { applyCampAction, leaveOutpostForFieldOrder, deploySquadAtOutpostRing, type CampAction } from "../src/sim/outpostActions.js";
import { chatService } from "../src/mmo/chat.js";
import { setDevAuthEnabled, isDevAuthEnabled } from "../src/mmo/devAuth.js";
import { spawnStarterBandsNearPlayer } from "../src/barbarians/barbarianSpawnPlacements.js";
import { canAcceptPlayerAuth, getMaxPlayers } from "../src/mmo/wsLimits.js";
import { handleMmoApi, type MmoApiContext } from "./mmo-api.js";
import { corsHeaders } from "../src/mmo/cors.js";
import {
  incrementBarbariansKilled,
  incrementPvpKill,
  incrementPvpDeath,
  flushPlayTimeMs,
  updateExploredPctMax,
  completeMission,
  type MissionCompletePayload,
} from "../src/mmo/stats.js";
import { processDailyQuestEvents } from "../src/mmo/dailyQuests.js";
import { rebuildRankingFromPg } from "../src/mmo/ranking.js";
import { getPool } from "../src/mmo/db.js";
import { getRedis } from "../src/mmo/redis.js";
import type { SimEvent } from "../src/sim/events.js";
import {
  applyWorldSnapshot,
  CHECKPOINT_INTERVAL_MS,
  computeCatchUpTicks,
  getOrCreateWorld,
  getShardId,
  loadLatestCheckpoint,
  OFFLINE_TICK_DIVISOR,
  runCatchUpTicks,
  saveCheckpoint,
} from "../src/persist/worldPersistence.js";
import {
  buildChronicleContext,
  chronicleEntriesForClient,
  recordPlayerChronicleEntry,
  recordWorldEvents,
} from "../src/persist/chronicleRecorder.js";
import {
  loadPlayerWorldState,
  restoreOrCreateSquad,
  savePlayerWorldState,
  encodeFogBlob,
} from "../src/persist/playerWorldState.js";
import { BRAND, worldDisplayName } from "../src/shared/branding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveProjectRoot(fromDir: string): string {
  const candidates = [path.resolve(fromDir, ".."), path.resolve(fromDir, "../..")];
  for (const root of candidates) {
    if (fs.existsSync(path.join(root, "viewer", "index.html"))) return root;
  }
  return candidates[0]!;
}

const ROOT = resolveProjectRoot(__dirname);

function loadEnvFile(): void {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

loadEnvFile();

const mmoCtx: MmoApiContext = { dbReady: false, redisReady: false };

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? "3333");
const OVERVIEW_PNG_SCALE = 8;

function overviewPngNeedsRegen(seed: number): boolean {
  if (!hasOverviewPng(seed)) return true;
  try {
    const buf = fs.readFileSync(overviewPngPath(seed));
    return buf.readUInt32BE(16) < 512 * 6;
  } catch { return true; }
}

const SERVE_ONLY = process.env.WORLDGEN_SERVE_ONLY === "1";
const API_ONLY = process.env.DF_API_ONLY === "1" || process.env.VELIS_API_ONLY === "1";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SIM_METRICS = process.env.SIM_METRICS === "1";
const DEBUG_PERF = process.env.DF_DEBUG_PERF === "1" || process.env.VELIS_DEBUG_PERF === "1";

const perfTickMs: number[] = [];
const perfBroadcastMs: number[] = [];
let perfWsBytesWindow = 0;
let perfLastLogMs = Date.now();

function recordPerfTickMs(ms: number): void {
  perfTickMs.push(ms);
}

function recordPerfBroadcastMs(ms: number): void {
  perfBroadcastMs.push(ms);
}

function perfP95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)]!;
}

function maybeLogPerfMetrics(wsClientCount: number): void {
  if (!DEBUG_PERF) return;
  const now = Date.now();
  if (now - perfLastLogMs < 10_000) return;

  const elapsedSec = (now - perfLastLogMs) / 1000;
  const bytesPerSec = elapsedSec > 0 ? Math.round(perfWsBytesWindow / elapsedSec) : 0;

  console.log(
    `[df-perf] tickMs_p95=${perfP95(perfTickMs).toFixed(2)} ` +
    `broadcastMs_p95=${perfP95(perfBroadcastMs).toFixed(2)} ` +
    `wsClients=${wsClientCount} ` +
    `ws_bytes_per_s=${bytesPerSec}`,
  );

  perfTickMs.length = 0;
  perfBroadcastMs.length = 0;
  perfWsBytesWindow = 0;
  perfLastLogMs = now;
}

let ssePayloadBytes = 0;
let sseBroadcastCount = 0;
let lastSseMetricsLogMs = Date.now();
let simTickSeq = 0;

function maybeLogSseMetrics(payloadBytes: number): void {
  if (!SIM_METRICS) return;
  ssePayloadBytes += payloadBytes;
  sseBroadcastCount++;
  const now = Date.now();
  if (now - lastSseMetricsLogMs < 5000) return;
  const avgKb = sseBroadcastCount > 0
    ? ((ssePayloadBytes / sseBroadcastCount) / 1024).toFixed(2)
    : "0";
  console.log(
    `[sse-metrics] broadcasts=${sseBroadcastCount} avg_payload_kb=${avgKb} clients=${sseClients.size}`,
  );
  ssePayloadBytes = 0;
  sseBroadcastCount = 0;
  lastSseMetricsLogMs = now;
}

// ── Macro world (in-memory, one per seed) ────────────────────────────────────

let macroWorld: MacroWorld | null = null;
let macroSeed  = -1;
const memTileCache = new TileCache(256);

function getMacro(seed: number, params: Partial<TerrainParams>): MacroWorld {
  if (macroWorld && macroSeed === seed) return macroWorld;

  if (hasMacro(seed)) {
    macroWorld = decodeMacro(loadMacro(seed));
    macroSeed  = seed;
    scheduleBackgroundTileGen(seed, macroWorld);
    return macroWorld;
  }

  if (SERVE_ONLY) throw new SeedNotAvailable(`seed ${seed} not pre-generated`);

  console.log(`Generating macro world seed=${seed} (${MACRO_COLS}×${MACRO_ROWS})…`);
  macroWorld = generateMacroWorld(seed, params);
  macroSeed  = seed;
  saveMacro(seed, encodeMacro(macroWorld));
  console.log("Macro world ready (cached to disk).");
  scheduleBackgroundTileGen(seed, macroWorld);
  return macroWorld;
}

function buildOverviewBin(macro: MacroWorld, params: Partial<TerrainParams>): Buffer {
  const ov = generateOverview(macro, params);
  return encodeTile(ov.cells as any, ov.heights, ov.hillshade, ov.cols, ov.rows);
}

const worldMetaCache = new Map<number, WorldMeta>();

function getWorldMeta(seed: number, macro: MacroWorld): WorldMeta {
  const cached = worldMetaCache.get(seed);
  if (cached) return cached;
  if (hasWorldMeta(seed)) {
    const m = loadWorldMeta(seed) as WorldMeta;
    worldMetaCache.set(seed, m);
    return m;
  }
  const meta = computeWorldMeta(macro, seed);
  worldMetaCache.set(seed, meta);
  saveWorldMeta(seed, JSON.stringify(meta));
  return meta;
}

let bgGenSeed    = -1;
let bgGenQueue:  [number,number][] = [];
let bgGenRunning = false;

function scheduleBackgroundTileGen(seed: number, macro: MacroWorld): void {
  if (bgGenSeed === seed) return;
  bgGenSeed  = seed;
  bgGenQueue = [];

  const cx = WORLD_TILES_X / 2, cy = WORLD_TILES_Y / 2;
  const pending: [number,number,number][] = [];
  for (let ty = 0; ty < WORLD_TILES_Y; ty++)
    for (let tx = 0; tx < WORLD_TILES_X; tx++)
      if (!hasTile(seed, tx, ty))
        pending.push([tx, ty, (tx-cx)**2 + (ty-cy)**2]);
  pending.sort((a,b) => a[2]-b[2]);
  bgGenQueue = pending.map(([tx,ty]) => [tx,ty]);

  const total = WORLD_TILES_X * WORLD_TILES_Y;
  const already = total - bgGenQueue.length;
  if (bgGenQueue.length === 0) {
    console.log(`  All ${total} tiles already cached ✓`);
    return;
  }
  console.log(`  Background tile gen: ${already}/${total} cached — queuing ${bgGenQueue.length} tiles…`);
  if (!bgGenRunning) runBgGen(seed, macro);
}

function runBgGen(seed: number, macro: MacroWorld): void {
  if (bgGenQueue.length === 0) { bgGenRunning = false; console.log("  Background tile gen complete ✓"); return; }
  bgGenRunning = true;
  const [tx, ty] = bgGenQueue.shift()!;
  if (!hasTile(seed, tx, ty)) {
    try {
      const t   = memTileCache.get(seed, tx, ty) ?? generateTile(macro, tx, ty, {});
      const raw = encodeTile(t.cells as any, t.heights, t.hillshade, TILE_SIZE, TILE_SIZE);
      saveTile(seed, tx, ty, raw);
    } catch { /* non-fatal */ }
  }
  setImmediate(() => runBgGen(seed, macro));
}

function ensureTileRaw(
  seed: number,
  tx: number,
  ty: number,
  params: Partial<TerrainParams>,
): Buffer {
  if (!hasTile(seed, tx, ty)) {
    if (SERVE_ONLY) throw new SeedNotAvailable(`seed ${seed} tile not pre-generated`);
    const macro = getMacro(seed, params);
    const t = memTileCache.get(seed, tx, ty) ?? generateTile(macro, tx, ty, params);
    memTileCache.set(seed, tx, ty, t);
    const raw = encodeTile(t.cells as any, t.heights, t.hillshade, TILE_SIZE, TILE_SIZE);
    saveTile(seed, tx, ty, raw);
    return raw;
  }
  return zlib.gunzipSync(loadTileGz(seed, tx, ty));
}

// ── Simulation ────────────────────────────────────────────────────────────────

let simState: WorldState | null = null;
let persistentWorldId: string | null = null;
let persistentSeedStr = BRAND.defaultWorldSeed;
let lastCheckpointWallMs = 0;
let offlineTickCounter = 0;
const sseClients = new Set<http.ServerResponse>();
let simInterval: ReturnType<typeof setInterval> | null = null;
let simRng = mulberry32(42);

interface WsSimClient {
  ws: WebSocket;
  profileId: string | null;
  captainName: string | null;
  authenticated: boolean;
  sessionStartedAt: number | null;
  lastPlayTimeFlushMs: number | null;
  missionReported: boolean;
  lastSent: Map<string, string>;
  lastSentOtherSquads: Map<string, string>;
  lastPlayerSquadHash: string | null;
  squadX: number | null;
  squadY: number | null;
  hasSnapshot: boolean;
  fogBlob: string | null;
}

const PLAY_TIME_FLUSH_MS = 60_000;
const RANKING_REBUILD_MS = 5 * 60_000;

const wsClients = new Set<WsSimClient>();

function countAuthenticatedWsClients(): number {
  let n = 0;
  for (const c of wsClients) {
    if (c.authenticated && c.profileId) n++;
  }
  return n;
}

function ensureOutposts(state: WorldState): void {
  if (state.outposts.size > 0) return;
  state.outposts = generateOutposts(
    state.terrain,
    state.seed,
    state.spawnHints,
    () => String(state.nextId++),
  );
}

function createFreshSimState(
  seed: number,
  macro: MacroWorld,
  meta: WorldMeta,
): WorldState {
  const state: WorldState = {
    seed,
    simTimeMs: 0,
    realStartMs: Date.now(),
    speedMultiplier: 1,
    paused: false,
    terrain: {
      cells: macro.cells as WorldState["terrain"]["cells"],
      heights: macro.heights,
      hillshade: macro.hillshade,
      cols: macro.cols,
      rows: macro.rows,
      seed,
    },
    season: initSeason(0),
    camps: new Map(),
    outposts: new Map(),
    cities: new Map(),
    barbarianGroups: new Map(),
    usedBarbarianNames: new Set(),
    playerSquads: new Map(),
    spawnHints: {
      pois: meta.pois.map((p: { col: number; row: number }) => ({
        x: p.col + 0.5,
        y: p.row + 0.5,
      })),
    },
    nextId: 1,
  };
  ensureOutposts(state);
  return state;
}

async function maybeSaveCheckpoint(): Promise<void> {
  if (!mmoCtx.dbReady || !simState || !persistentWorldId) return;
  const now = Date.now();
  if (now - lastCheckpointWallMs < CHECKPOINT_INTERVAL_MS) return;
  lastCheckpointWallMs = now;
  try {
    await saveCheckpoint(getPool(), persistentWorldId, simState);
  } catch (err) {
    console.warn("[persist] checkpoint save failed:", err);
  }
}

async function bootstrapPersistentWorld(): Promise<void> {
  if (!mmoCtx.dbReady) return;

  const seedStr = persistentSeedStr;
  const seed = parseSeed(seedStr);
  const shardId = getShardId();
  const displayName = worldDisplayName(seedStr);

  try {
    const world = await getOrCreateWorld(getPool(), seedStr, shardId, displayName);
    persistentWorldId = world.id;

    const macro = getMacro(seed, {});
    const meta = getWorldMeta(seed, macro);

    if (!simState || simState.seed !== seed) {
      simRng = deriveRng(seed, "sim");
      simState = createFreshSimState(seed, macro, meta);

      const checkpoint = await loadLatestCheckpoint(getPool(), world.id);
      if (checkpoint) {
        applyWorldSnapshot(simState, checkpoint);
        ensureOutposts(simState);
        console.log(`[persist] restored checkpoint simTimeMs=${simState.simTimeMs}`);
      } else {
        ensureOutposts(simState);
      }

      const catchUpTicks = computeCatchUpTicks(world.last_tick_at);
      if (catchUpTicks > 0) {
        console.log(`[persist] offline catch-up: ${catchUpTicks} ticks`);
        const catchUpEvents = runCatchUpTicks(simState, catchUpTicks, simRng);
        if (catchUpEvents.length) {
          const ctx = buildChronicleContext(simState);
          await recordWorldEvents(
            getPool(),
            world.id,
            simState.simTimeMs,
            simTickSeq,
            catchUpEvents,
            ctx,
          );
        }
      }

      lastCheckpointWallMs = Date.now();
      startSimLoop();
      startCheckpointInterval();
    }
  } catch (err) {
    console.warn("[persist] bootstrap failed (sim runs in-memory):", err);
  }
}

let checkpointInterval: ReturnType<typeof setInterval> | null = null;

function startCheckpointInterval(): void {
  if (checkpointInterval || !mmoCtx.dbReady) return;
  checkpointInterval = setInterval(() => {
    void maybeSaveCheckpoint();
  }, CHECKPOINT_INTERVAL_MS);
}

function broadcastSse(data: object): void {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  maybeLogSseMetrics(Buffer.byteLength(msg, "utf8"));
  for (const c of sseClients) { try { c.write(msg); } catch { sseClients.delete(c); } }
}

function sendWs(client: WsSimClient, data: object): void {
  if (client.ws.readyState !== client.ws.OPEN) return;
  try {
    const msg = JSON.stringify(data);
    if (DEBUG_PERF) perfWsBytesWindow += Buffer.byteLength(msg, "utf8");
    client.ws.send(msg);
  } catch { wsClients.delete(client); }
}

function broadcastWsTick(events: ReturnType<typeof tick>): void {
  if (!simState || wsClients.size === 0) return;
  simTickSeq++;
  const base = buildTickPayload(simState, events);
  const allGroups = base.barbarianGroups;
  const groupPositions = buildGroupPositionIndex(simState);
  const allMovements = base.movements;

  for (const client of wsClients) {
    if (!client.authenticated || !client.profileId) continue;
    syncClientAoiAnchor(client, simState);

    const { visible } = filterGroupsForClient(
      allGroups, client.squadX, client.squadY, simTickSeq,
    );

    const allOther = getOtherSquadsFromState(simState, client.profileId);
    const { visible: visibleOther } = filterOtherSquadsForClient(
      allOther, client.squadX, client.squadY, simTickSeq, client.profileId,
    );

    const clientEvents = filterEventsForClient(
      base.events, client.squadX, client.squadY, client.profileId, groupPositions,
    );
    const clientMovements = filterMovementsForClient(
      allMovements, client.squadX, client.squadY,
    );

    const squad = simState.playerSquads.get(client.profileId);
    const playerSquad = serializePlayerSquad(squad);
    const squadHash = hashPlayerSquad(playerSquad);

    if (!client.hasSnapshot) {
      client.hasSnapshot = true;
      client.lastPlayerSquadHash = squadHash;
      const snap = {
        type: "snapshot",
        seq: simTickSeq,
        gameVersion: getGameVersionString(),
        simTimeMs: base.simTimeMs,
        season: base.season,
        phase: base.phase,
        events: clientEvents,
        movements: clientMovements,
        camps: base.camps,
        outposts: base.outposts,
        barbarianGroups: visible,
        cities: base.cities,
        playerSquad,
        otherSquads: visibleOther,
      };
      for (const g of visible) client.lastSent.set(g.id, JSON.stringify(g));
      for (const s of visibleOther) client.lastSentOtherSquads.set(s.profileId, hashOtherSquad(s));
      sendWs(client, snap);
      continue;
    }

    const { changed, removed } = computeBarbDelta(client.lastSent, visible, false);
    const { changed: otherChanged, removedProfileIds } = computeOtherSquadsDelta(
      client.lastSentOtherSquads, visibleOther, false,
    );
    const squadChanged = client.lastPlayerSquadHash !== squadHash;
    if (
      changed.length === 0 && removed.length === 0
      && otherChanged.length === 0 && removedProfileIds.length === 0
      && clientEvents.length === 0 && !squadChanged
    ) continue;

    if (squadChanged) client.lastPlayerSquadHash = squadHash;

    sendWs(client, {
      type: "delta",
      seq: simTickSeq,
      gameVersion: getGameVersionString(),
      simTimeMs: base.simTimeMs,
      season: base.season,
      phase: base.phase,
      events: clientEvents,
      movements: clientMovements,
      barbarianGroups: changed,
      removed,
      ...(otherChanged.length > 0 ? { otherSquads: otherChanged } : {}),
      ...(removedProfileIds.length > 0 ? { removedProfileIds } : {}),
      ...(squadChanged ? { playerSquad } : {}),
    });
  }
}

function processDailyQuestsForClient(
  client: WsSimClient,
  events: SimEvent[],
  exploredPctMax?: number,
): void {
  if (!client.profileId || !mmoCtx.dbReady || !mmoCtx.redisReady) return;
  void processDailyQuestEvents(client.profileId, events, exploredPctMax).then(result => {
    if (!result) return;
    if (result.goldReward > 0 && simState) {
      const squad = simState.playerSquads.get(client.profileId!);
      if (squad) squad.gold = (squad.gold ?? 0) + result.goldReward;
    }
    sendWs(client, {
      type: "daily_quest_progress",
      day: result.state.day,
      quests: result.state.quests,
      completed: result.completed.map(q => q.kind),
      goldReward: result.goldReward,
    });
  }).catch(err => console.warn("[daily-quests] progress failed:", err));
}

function processDailyQuestsFromEvents(events: SimEvent[]): void {
  if (!mmoCtx.dbReady || !mmoCtx.redisReady) return;
  const byProfile = new Map<string, SimEvent[]>();
  for (const ev of events) {
    if (ev.type === "GROUP_DEFEATED" && ev.profileId) {
      const list = byProfile.get(ev.profileId) ?? [];
      list.push(ev);
      byProfile.set(ev.profileId, list);
    }
    if (ev.type === "PVP_COMBAT_END" && ev.winnerProfileId) {
      const list = byProfile.get(ev.winnerProfileId) ?? [];
      list.push(ev);
      byProfile.set(ev.winnerProfileId, list);
    }
  }
  for (const client of wsClients) {
    if (!client.authenticated || !client.profileId) continue;
    const evs = byProfile.get(client.profileId) ?? [];
    if (evs.length) processDailyQuestsForClient(client, evs);
  }
}

function broadcastSimTick(events: ReturnType<typeof tick>, tickMs?: number): void {
  if (!simState) return;
  if (mmoCtx.dbReady && mmoCtx.redisReady) {
    processCombatStats(events);
    processDailyQuestsFromEvents(events);
  }
  if (mmoCtx.dbReady && persistentWorldId && events.length) {
    void (async () => {
      try {
        const ctx = buildChronicleContext(simState!);
        const entries = await recordWorldEvents(
          getPool(),
          persistentWorldId!,
          simState!.simTimeMs,
          simTickSeq,
          events,
          ctx,
        );
        for (const client of wsClients) {
          if (!client.authenticated) continue;
          const pushEntries = chronicleEntriesForClient(
            entries,
            client.squadX,
            client.squadY,
          );
          for (const entry of pushEntries) {
            sendWs(client, {
              type: "chronicle_entry",
              id: entry.id,
              headline: entry.headline,
              body: entry.body,
              weight: entry.weight,
              simTimeMs: entry.simTimeMs,
            });
          }
        }
      } catch (err) {
        console.warn("[persist] chronicle record failed:", err);
      }
    })();
  }
  void maybeSaveCheckpoint();
  const payload = buildTickPayload(simState, events);
  broadcastSse({ type: "TICK", ...payload });

  const bcStart = DEBUG_PERF ? performance.now() : 0;
  broadcastWsTick(events);
  if (DEBUG_PERF) {
    if (tickMs !== undefined) recordPerfTickMs(tickMs);
    recordPerfBroadcastMs(performance.now() - bcStart);
    maybeLogPerfMetrics(countAuthenticatedWsClients());
  }
}

function processCombatStats(events: SimEvent[]): void {
  for (const ev of events) {
    if (ev.type === "GROUP_DEFEATED") {
      if (ev.winnerGroupId !== "player" || !ev.profileId) continue;
      void incrementBarbariansKilled(ev.profileId).catch(err => {
        console.warn("[mmo-stats] kill increment failed:", err);
      });
      continue;
    }
    if (ev.type === "PVP_COMBAT_END" && ev.reason === "elimination") {
      if (ev.winnerProfileId) {
        void incrementPvpKill(ev.winnerProfileId).catch(err => {
          console.warn("[mmo-stats] pvp kill increment failed:", err);
        });
      }
      if (ev.loserProfileId) {
        void incrementPvpDeath(ev.loserProfileId).catch(err => {
          console.warn("[mmo-stats] pvp death increment failed:", err);
        });
      }
    }
  }
}

async function flushClientPlayTime(client: WsSimClient): Promise<void> {
  if (!client.profileId || !client.sessionStartedAt || !mmoCtx.dbReady) return;
  const now = Date.now();
  const from = client.lastPlayTimeFlushMs ?? client.sessionStartedAt;
  const delta = now - from;
  if (delta <= 0) return;
  client.lastPlayTimeFlushMs = now;
  try {
    await flushPlayTimeMs(client.profileId, delta);
  } catch (err) {
    console.warn("[mmo-stats] playTime flush failed:", err);
  }
}

function flushAllPlayTimes(): void {
  if (!mmoCtx.dbReady) return;
  for (const client of wsClients) {
    if (client.authenticated && client.profileId) {
      void flushClientPlayTime(client);
    }
  }
}

let playTimeInterval: ReturnType<typeof setInterval> | null = null;
let rankingRebuildInterval: ReturnType<typeof setInterval> | null = null;

function startMmoBackgroundJobs(): void {
  if (!mmoCtx.dbReady || !mmoCtx.redisReady) return;
  if (!playTimeInterval) {
    playTimeInterval = setInterval(flushAllPlayTimes, PLAY_TIME_FLUSH_MS);
  }
  if (!rankingRebuildInterval) {
    rankingRebuildInterval = setInterval(() => {
      void rebuildRankingFromPg(getPool(), getRedis()).catch(err => {
        console.warn("[mmo-ranking] rebuild failed:", err);
      });
    }, RANKING_REBUILD_MS);
  }
}

function startSimLoop(): void {
  if (simInterval) return;
  simInterval = setInterval(() => {
    if (!simState || simState.paused) return;

    const hasPlayers = countAuthenticatedWsClients() > 0;
    if (!hasPlayers) {
      offlineTickCounter++;
      if (offlineTickCounter < OFFLINE_TICK_DIVISOR) return;
      offlineTickCounter = 0;
    } else {
      offlineTickCounter = 0;
    }

    const tickStart = DEBUG_PERF ? performance.now() : 0;
    const dt = simDtMs(1);
    const events = tick(simState, dt, simRng);
    const tickMs = DEBUG_PERF ? performance.now() - tickStart : undefined;
    broadcastSimTick(events, tickMs);
  }, 50);
}

function applySquadSpawnMeta(squad: PlayerSquad, spawnX: number, spawnY: number, joinedAt: number): void {
  squad.spawnX = spawnX;
  squad.spawnY = spawnY;
  squad.sessionJoinedAtMs = joinedAt;
  squad.unitOrder ??= squad.order === "hold" ? "hold" : "move";
  squad.attackProfileId ??= null;
  squad.waypoints ??= [];
  squad.pvpRetreatSinceMs ??= null;
  squad.pvpCooldownUntilMs ??= 0;
}

async function restorePlayerOnConnect(client: WsSimClient): Promise<void> {
  if (!simState || !client.profileId || !client.captainName) return;

  const joinedAt = client.sessionStartedAt ?? Date.now();
  let savedGold = 0;
  let savedHomeOutpost: string | null = null;
  let savedLastX: number | null = null;
  let savedLastY: number | null = null;
  let savedSquad: PlayerSquad | null = null;

  if (mmoCtx.dbReady && persistentWorldId) {
    try {
      const saved = await loadPlayerWorldState(getPool(), persistentWorldId, client.profileId);
      if (saved?.fogBlob) client.fogBlob = saved.fogBlob;
      savedSquad = saved?.squad ?? null;
      savedGold = saved?.gold ?? savedSquad?.gold ?? 0;
      savedHomeOutpost = saved?.homeOutpostId ?? savedSquad?.homeOutpostId ?? null;
      savedLastX = saved?.lastX ?? null;
      savedLastY = saved?.lastY ?? null;
    } catch (err) {
      console.warn("[persist] load player state failed:", err);
    }
  }

  const preferId = savedSquad?.wiped
    ? (savedHomeOutpost ?? savedSquad.homeOutpostId)
    : null;
  const spawnPick = pickSpawnOutpost(
    simState,
    client.profileId,
    preferId,
    savedLastX,
    savedLastY,
  );
  if (!spawnPick) return;

  const restored = restoreOrCreateSquad(
    savedSquad,
    client.profileId,
    client.captainName,
    spawnPick.x,
    spawnPick.y,
    joinedAt,
    spawnPick.outpostId || undefined,
    savedGold,
    savedHomeOutpost ?? spawnPick.outpostId ?? null,
  );

  if (!savedSquad && spawnPick.outpostId) {
    deploySquadAtOutpostRing(simState, restored.squad, spawnPick.outpostId);
  }

  applySquadSpawnMeta(restored.squad, spawnPick.x, spawnPick.y, joinedAt);
  simState.playerSquads.set(client.profileId, restored.squad);

  if (restored.squad.wiped) {
    client.squadX = spawnPick.x;
    client.squadY = spawnPick.y;
  } else {
    const c = getPlayerCentroid(restored.squad.units);
    client.squadX = c.x;
    client.squadY = c.y;
  }

  if (restored.wiped && mmoCtx.dbReady && persistentWorldId) {
    await recordPlayerChronicleEntry(
      getPool(),
      client.profileId,
      `Capitán ${client.captainName} cayó en combate`,
      "El batallón aguarda reagruparse en un campamento.",
    );
  }

  if (!savedSquad && !restored.wiped) {
    spawnStarterBandsNearPlayer(simState, spawnPick.x, spawnPick.y, simState.simTimeMs, simRng);
  }
}

function getClientSquad(client: WsSimClient): PlayerSquad | null {
  if (!simState || !client.profileId) return null;
  return simState.playerSquads.get(client.profileId) ?? null;
}

function ensureClientSquad(client: WsSimClient): PlayerSquad | null {
  if (!simState || !client.profileId || !client.captainName) {
    throw new Error("WS client not authenticated");
  }

  const existing = simState.playerSquads.get(client.profileId);
  if (existing) {
    if (existing.wiped) return existing;
    if (isSquadAlive(existing)) {
      applySquadSpawnMeta(existing, existing.spawnX, existing.spawnY, client.sessionStartedAt ?? Date.now());
      const c = getPlayerCentroid(existing.units);
      client.squadX = c.x;
      client.squadY = c.y;
      return existing;
    }
  }

  return getClientSquad(client);
}

async function handleWsAuth(client: WsSimClient, token: string): Promise<void> {
  if (!mmoCtx.redisReady && !isDevAuthEnabled()) {
    sendWs(client, { type: "auth_err", reason: "invalid_token" });
    client.ws.close();
    return;
  }

  try {
    const session = await validateSessionToken(token);
    if (!session) {
      sendWs(client, { type: "auth_err", reason: "invalid_token" });
      client.ws.close();
      return;
    }

    if (!canAcceptPlayerAuth(wsClients, session.profileId, getMaxPlayers())) {
      sendWs(client, { type: "auth_err", reason: "server_full" });
      client.ws.close();
      return;
    }

    client.profileId = session.profileId;
    client.captainName = session.captainName;
    client.authenticated = true;
    client.sessionStartedAt = Date.now();
    client.lastPlayTimeFlushMs = client.sessionStartedAt;
    client.missionReported = false;

    await refreshOnlinePresence(session.profileId);

    sendWs(client, {
      type: "auth_ok",
      profileId: session.profileId,
      captainName: session.captainName,
    });

    await restorePlayerOnConnect(client);
    sendInitialSnapshot(client);
  } catch {
    sendWs(client, { type: "auth_err", reason: "invalid_token" });
    client.ws.close();
  }
}

function sendInitialSnapshot(client: WsSimClient): void {
  if (!simState || !client.authenticated) return;

  const existing = client.profileId
    ? simState.playerSquads.get(client.profileId)
    : undefined;
  if (existing && isSquadAlive(existing)) {
    const c = getPlayerCentroid(existing.units);
    client.squadX = c.x;
    client.squadY = c.y;
  }

  simTickSeq++;
  const base = buildTickPayload(simState, []);
  const { visible } = filterGroupsForClient(
    allGroupsFromState(), client.squadX, client.squadY, simTickSeq,
  );
  const allOther = client.profileId
    ? getOtherSquadsFromState(simState, client.profileId)
    : [];
  const { visible: visibleOther } = filterOtherSquadsForClient(
    allOther, client.squadX, client.squadY, simTickSeq, client.profileId ?? undefined,
  );
  const squad = client.profileId ? simState.playerSquads.get(client.profileId) : undefined;
  const playerSquad = serializePlayerSquad(squad);
  client.hasSnapshot = true;
  client.lastPlayerSquadHash = hashPlayerSquad(playerSquad);
  for (const g of visible) client.lastSent.set(g.id, JSON.stringify(g));
  for (const s of visibleOther) client.lastSentOtherSquads.set(s.profileId, hashOtherSquad(s));
  sendWs(client, {
    type: "snapshot",
    seq: simTickSeq,
    gameVersion: getGameVersionString(),
    simTimeMs: base.simTimeMs,
    season: base.season,
    phase: base.phase,
    events: [],
    movements: filterMovementsForClient(base.movements, client.squadX, client.squadY),
    camps: base.camps,
    outposts: base.outposts,
    barbarianGroups: visible,
    cities: base.cities,
    playerSquad,
    otherSquads: visibleOther,
    chatHistory: client.profileId
      ? chatService.getHistoryForClient(simState, client.profileId)
      : [],
    ...(client.fogBlob ? { fogBlob: client.fogBlob } : {}),
  });
}

function handleWsMessage(client: WsSimClient, raw: string): void {
  if (!simState) return;
  try {
    const msg = JSON.parse(raw) as {
      type?: string;
      token?: string;
      x?: number;
      y?: number;
      exploredPct?: number;
      fogBlob?: string;
    };

    if (!client.authenticated) {
      if (msg.type === "auth" && typeof msg.token === "string") {
        void handleWsAuth(client, msg.token);
      }
      return;
    }

    if (!client.profileId || !client.captainName) return;

    if (msg.type === "stats" && typeof msg.exploredPct === "number") {
      if (typeof msg.fogBlob === "string" && msg.fogBlob.length <= 512_000) {
        client.fogBlob = msg.fogBlob;
      }
      if (!mmoCtx.dbReady || !mmoCtx.redisReady) return;
      const pct = msg.exploredPct;
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return;
      void updateExploredPctMax(client.profileId, pct).then(result => {
        if (result.ok) {
          sendWs(client, { type: "stats_ok", exploredPctMax: result.profile.stats.exploredPctMax });
          processDailyQuestsForClient(client, [], result.profile.stats.exploredPctMax);
        }
      }).catch(err => console.warn("[mmo-stats] explored sync failed:", err));
      return;
    }

    if (msg.type === "mission_complete") {
      if (!mmoCtx.dbReady || client.missionReported) return;
      client.missionReported = true;
      const payload: MissionCompletePayload = {
        exploredPct: typeof msg.exploredPct === "number" ? msg.exploredPct : undefined,
        neutralizedGroupId: typeof (msg as { neutralizedGroupId?: string }).neutralizedGroupId === "string"
          ? (msg as { neutralizedGroupId: string }).neutralizedGroupId
          : undefined,
        interceptDone: (msg as { interceptDone?: boolean }).interceptDone === true,
      };
      void completeMission(client.profileId, payload).then(result => {
        if (result.ok) {
          sendWs(client, {
            type: "mission_ok",
            missionsCompleted: result.profile.stats.missionsCompleted,
            compositeScore: result.profile.stats.compositeScore,
          });
        } else {
          client.missionReported = false;
          sendWs(client, { type: "mission_err", reason: result.reason });
        }
      }).catch(err => {
        client.missionReported = false;
        console.warn("[mmo-stats] mission complete failed:", err);
      });
      return;
    }

    if (msg.type === "pos" && typeof msg.x === "number" && typeof msg.y === "number") {
      if (simState) {
        const anchor = getClientAoiAnchor(client, simState);
        if (anchor) {
          const dist = macroDistance(msg.x, msg.y, anchor.x, anchor.y);
          if (dist > 8) {
            console.warn(
              `[ws] pos diverges from sim AOI by ${dist.toFixed(1)} cells (profile=${client.profileId})`,
            );
          }
        }
      }
      void refreshOnlinePresence(client.profileId);
      return;
    }

    const campMsg = parseCampActionMessage(msg);
    if (campMsg) {
      if (!simState) return;
      const result = applyCampAction(
        simState,
        client.profileId,
        campMsg.action as CampAction,
        campMsg.outpostId,
        {
          soldiers: campMsg.soldiers,
          snipers: campMsg.snipers,
          instantHeal: campMsg.instantHeal,
        },
      );
      if (!result.ok) {
        sendWs(client, { type: "camp_err", reason: result.reason });
        return;
      }
      for (const ev of result.events) {
        sendWs(client, { type: "event", event: ev });
      }
      const squad = simState.playerSquads.get(client.profileId);
      if (squad && !squad.wiped) {
        const c = getPlayerCentroid(squad.units);
        client.squadX = c.x;
        client.squadY = c.y;
      } else if (squad?.wiped) {
        const outpost = simState.outposts.get(campMsg.outpostId);
        if (outpost) {
          client.squadX = outpost.x;
          client.squadY = outpost.y;
        }
      }
      sendWs(client, {
        type: "camp_ok",
        action: campMsg.action,
        playerSquad: serializePlayerSquad(squad),
      });
      return;
    }

    const squadMsg = parseSquadActionMessage(msg);
    if (squadMsg) {
      if (!simState) return;
      const squad = simState.playerSquads.get(client.profileId);
      if (!squad || squad.wiped) {
        sendWs(client, { type: "squad_err", reason: "squad_wiped" });
        return;
      }
      if (squadMsg.action === "unstuck") {
        if (squad.insideOutpostId) {
          sendWs(client, { type: "squad_err", reason: "inside_outpost" });
          return;
        }
        if (simState.simTimeMs < (squad.unstuckCooldownUntilMs ?? 0)) {
          sendWs(client, { type: "squad_err", reason: "cooldown" });
          return;
        }
        const stuckBefore = countStuckUnits(squad, simState.terrain);
        const moved = unstuckPlayerSquad(squad, simState.terrain);
        if (moved <= 0) {
          sendWs(client, { type: "squad_err", reason: stuckBefore > 0 ? "no_safe_tile" : "not_stuck" });
          return;
        }
        squad.unstuckCooldownUntilMs = simState.simTimeMs + UNSTUCK_COOLDOWN_MS;
        const c = getPlayerCentroid(squad.units.filter(u => u.hp > 0));
        client.squadX = c.x;
        client.squadY = c.y;
        sendWs(client, {
          type: "event",
          event: { type: "SQUAD_UNSTUCK", profileId: client.profileId, unitsMoved: moved },
        });
        sendWs(client, {
          type: "squad_ok",
          action: "unstuck",
          unitsMoved: moved,
          playerSquad: serializePlayerSquad(squad),
        });
      }
      return;
    }

    const chatMsg = parseChatSendMessage(msg);
    if (chatMsg) {
      if (!simState) return;
      const result = chatService.trySend(
        simState,
        client.profileId,
        client.captainName,
        chatMsg.channel,
        chatMsg.text,
      );
      if (!result.ok) {
        sendWs(client, { type: "chat_err", reason: result.reason });
        return;
      }
      const recipients = chatService.getRecipients(
        simState,
        result.msg,
        [...wsClients].filter(c => c.authenticated && c.profileId).map(c => c.profileId!),
      );
      for (const pid of recipients) {
        for (const c of wsClients) {
          if (c.profileId === pid) {
            sendWs(c, { type: "chat_msg", ...result.msg });
          }
        }
      }
      return;
    }

    const bounds = { cols: simState.terrain.cols, rows: simState.terrain.rows };
    const order = parsePlayerOrderMessage(msg, bounds);
    if (!order) return;

    const squad = ensureClientSquad(client);
    if (!squad || squad.wiped) {
      sendWs(client, { type: "order_err", reason: "squad_wiped" });
      return;
    }

    if (order.order === "attack" && order.groupId) {
      const target = simState.barbarianGroups.get(order.groupId);
      if (!target || !target.units.some(u => u.hp > 0)) return;
    }

    if (order.order === "attack_pvp" && order.targetProfileId) {
      if (order.targetProfileId === client.profileId) return;
      const defender = simState.playerSquads.get(order.targetProfileId);
      if (!defender || !isSquadAlive(defender)) return;
      const pvpErr = canInitiatePvp(squad, defender, Date.now(), simState.simTimeMs, simState);
      if (pvpErr) {
        sendWs(client, { type: "order_err", reason: pvpErr });
        return;
      }
      defender.attackProfileId = client.profileId;
    }

    const unitOrder = order.order === "fire_hold" ? "fire_hold"
      : order.order === "stealth" ? "stealth"
      : order.order === "attack_move" ? "attack_move"
      : undefined;

    if (order.order !== "hold") {
      leaveOutpostForFieldOrder(simState, squad);
    }

    applyPlayerOrder(
      squad,
      order.order,
      order.x,
      order.y,
      order.groupId,
      simState.terrain,
      {
        attackProfileId: order.targetProfileId,
        unitOrder,
        appendWaypoint: order.appendWaypoint,
        unitIds: order.unitIds,
      },
    );
    void refreshOnlinePresence(client.profileId);
  } catch { /* ignore malformed */ }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url  = new URL(req.url!, `http://localhost:${PORT}`);
  const q    = parseQ(url);
  const gz   = (req.headers["accept-encoding"] ?? "").includes("gzip");

  if (await handleMmoApi(req, res, url, mmoCtx)) return;

  if (url.pathname === "/api/version" && req.method === "GET") {
    sendJson(req, res, getGameVersion());
    return;
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(req, res, {
      ok: mmoCtx.dbReady && mmoCtx.redisReady && simState != null,
      pg: mmoCtx.dbReady,
      redis: mmoCtx.redisReady,
      sim: simState != null,
      wsClients: countAuthenticatedWsClients(),
    });
    return;
  }

  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    res.writeHead(204, {
      ...corsHeaders(req),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    });
    res.end();
    return;
  }

  function qParams(): Partial<TerrainParams> {
    return {
      waterPercent:      q.waterPercent      ? Number(q.waterPercent)      : undefined,
      numPlates:         q.numPlates         ? Number(q.numPlates)         : undefined,
      erosionIterations: q.erosionIterations ? Number(q.erosionIterations) : undefined,
      windAngleDeg:      q.windAngleDeg      ? Number(q.windAngleDeg)      : undefined,
      mountainThreshold: q.mountainThreshold ? Number(q.mountainThreshold) : undefined,
      upliftStrength:    q.upliftStrength    ? Number(q.upliftStrength)    : undefined,
    };
  }

  if (url.pathname === "/api/overview.png") {
    const seed = parseSeed(q.seed as string);
    try {
      if (overviewPngNeedsRegen(seed)) {
        if (SERVE_ONLY) throw new SeedNotAvailable(`seed ${seed} not pre-generated`);
        saveOverviewPng(seed, renderOverviewPng(getMacro(seed, qParams()), qParams(), OVERVIEW_PNG_SCALE));
      }
      const buf = loadOverviewPng(seed);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
        ...corsHeaders(req),
      });
      res.end(buf);
    } catch (e) { sendErr(res, e, req); }
    return;
  }

  if (url.pathname === "/api/overview.bin") {
    const seed = parseSeed(q.seed as string);
    try {
      if (!hasOverview(seed)) {
        if (SERVE_ONLY) throw new SeedNotAvailable(`seed ${seed} not pre-generated`);
        saveOverview(seed, buildOverviewBin(getMacro(seed, qParams()), qParams()));
      }
      sendBin(res, loadOverviewGz(seed), gz, req);
    } catch (e) { sendErr(res, e, req); }
    return;
  }

  if (url.pathname === "/api/tile.bin") {
    const seed = parseSeed(q.seed as string);
    const tx   = Number(q.tx ?? 0);
    const ty   = Number(q.ty ?? 0);
    if (tx < 0 || ty < 0 || tx >= WORLD_TILES_X || ty >= WORLD_TILES_Y) {
      res.writeHead(400); res.end("out of bounds"); return;
    }
    try {
      if (!hasTile(seed, tx, ty)) {
        ensureTileRaw(seed, tx, ty, qParams());
      }
      sendBin(res, loadTileGz(seed, tx, ty), gz, req);
    } catch (e) { sendErr(res, e, req); }
    return;
  }

  if (url.pathname === "/api/tile.webp") {
    const seed = parseSeed(q.seed as string);
    const tx   = Number(q.tx ?? 0);
    const ty   = Number(q.ty ?? 0);
    if (tx < 0 || ty < 0 || tx >= WORLD_TILES_X || ty >= WORLD_TILES_Y) {
      res.writeHead(400); res.end("out of bounds"); return;
    }
    (async () => {
      try {
        if (!hasTileWebp(seed, tx, ty)) {
          const raw = ensureTileRaw(seed, tx, ty, qParams());
          saveTileWebp(seed, tx, ty, await bakeTileWebpFromBin(raw));
        }
        const buf = loadTileWebp(seed, tx, ty);
        res.writeHead(200, {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=31536000, immutable",
          ...corsHeaders(req),
        });
        res.end(buf);
      } catch (e) { sendErr(res, e, req); }
    })();
    return;
  }

  if (url.pathname === "/api/tile.png") {
    const seed = parseSeed(q.seed as string);
    const tx   = Number(q.tx ?? 0);
    const ty   = Number(q.ty ?? 0);
    if (tx < 0 || ty < 0 || tx >= WORLD_TILES_X || ty >= WORLD_TILES_Y) {
      res.writeHead(400); res.end("out of bounds"); return;
    }
    try {
      if (!hasTilePng(seed, tx, ty)) {
        const raw = ensureTileRaw(seed, tx, ty, qParams());
        saveTilePng(seed, tx, ty, bakeTilePngFromBin(raw));
      }
      const buf = loadTilePng(seed, tx, ty);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
        ...corsHeaders(req),
      });
      res.end(buf);
    } catch (e) { sendErr(res, e, req); }
    return;
  }

  if (url.pathname === "/api/world") {
    const seed = parseSeed(q.seed as string);
    try {
      const macro = getMacro(seed, qParams());
      if (!simState || simState.seed !== seed) {
        if (mmoCtx.dbReady && persistentWorldId) {
          // Already bootstrapped from checkpoint
        } else {
          simRng = deriveRng(seed, "sim");
          const meta = getWorldMeta(seed, macro);
          simState = createFreshSimState(seed, macro, meta);
          startSimLoop();
        }
      }
      const meta = getWorldMeta(seed, macro);
      sendJson(req, res, {
        seed, cols: MACRO_COLS, rows: MACRO_ROWS,
        tilesX: WORLD_TILES_X, tilesY: WORLD_TILES_Y, tileSize: TILE_SIZE,
        pois: meta.pois, regions: meta.regions, climateZones: meta.climateZones,
        biomeHistogram: meta.biomeHistogram,
        cachedTiles: cachedTileCount(seed),
        totalTiles: WORLD_TILES_X * WORLD_TILES_Y,
      });
    } catch (e) { sendErr(res, e, req); }
    return;
  }

  if (url.pathname === "/api/sim/control" && req.method === "POST") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      try {
        const cmd = JSON.parse(body);
        if (simState) {
          if (cmd.action === "play")  simState.paused = false;
          if (cmd.action === "pause") simState.paused = true;
          if (cmd.action === "speed") simState.speedMultiplier = Math.max(1, Math.min(3600, Number(cmd.value)));
          if (cmd.action === "step")  { simState.paused=false; tick(simState,simDtMs(simState.speedMultiplier)*10,simRng); simState.paused=true; }
          if (cmd.action === "reset") { macroWorld=null; macroSeed=-1; bgGenSeed=-1; }
        }
        res.writeHead(200, { "Content-Type":"application/json", ...corsHeaders(req) });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: String(e) })); }
    });
    return;
  }

  if (url.pathname === "/api/sim/stream") {
    res.writeHead(200, {
      "Content-Type":"text/event-stream",
      "Cache-Control":"no-cache",
      "Connection":"keep-alive",
      ...corsHeaders(req),
    });
    res.write(": connected\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (!API_ONLY && serveViewerStatic(url.pathname, res, ROOT)) return;

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ noServer: true });

async function handleWsDisconnect(client: WsSimClient): Promise<void> {
  wsClients.delete(client);
  if (!client.profileId) return;

  const profileId = client.profileId;
  const stillConnected = [...wsClients].some(
    c => c !== client && c.profileId === profileId && c.authenticated,
  );

  if (mmoCtx.dbReady) {
    await flushClientPlayTime(client);
  }
  if (mmoCtx.redisReady && !stillConnected) {
    try {
      await clearOnlinePresence(profileId);
    } catch (err) {
      console.warn("[mmo-session] clear online failed:", err);
    }
  }
  if (simState && !stillConnected) {
    const squad = simState.playerSquads.get(profileId);
    const lastX = client.squadX ?? 0;
    const lastY = client.squadY ?? 0;
    if (mmoCtx.dbReady && persistentWorldId) {
      try {
        await savePlayerWorldState(
          getPool(),
          persistentWorldId,
          profileId,
          squad ?? null,
          encodeFogBlob(client.fogBlob),
          lastX,
          lastY,
        );
      } catch (err) {
        console.warn("[persist] disconnect save failed:", err);
      }
    }
    simState.playerSquads.delete(profileId);
  }
}

wss.on("connection", (ws) => {
  const client: WsSimClient = {
    ws,
    profileId: null,
    captainName: null,
    authenticated: false,
    sessionStartedAt: null,
    lastPlayTimeFlushMs: null,
    missionReported: false,
    lastSent: new Map(),
    lastSentOtherSquads: new Map(),
    lastPlayerSquadHash: null,
    squadX: null,
    squadY: null,
    hasSnapshot: false,
    fogBlob: null,
  };
  wsClients.add(client);

  ws.on("message", (data) => {
    handleWsMessage(client, data.toString());
  });

  ws.on("close", () => { void handleWsDisconnect(client); });
});

function allGroupsFromState() {
  if (!simState) return [];
  return [...simState.barbarianGroups.values()]
    .map(serializeBarbarianGroup)
    .filter(g => g.units.length > 0);
}

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname !== "/api/sim/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

(async () => {
  try {
    await loadUnitConfigs();
    await loadBuildingConfigs();
    await loadTechConfigs();
    console.log("Economy configs loaded.");
  } catch (e) { console.warn("Economy configs failed (non-fatal):", e); }

  try {
    await initDb();
    mmoCtx.dbReady = true;
    console.log("PostgreSQL connected.");
  } catch (e) {
    console.warn("PostgreSQL unavailable (MMO auth disabled):", e);
  }

  try {
    await initRedis();
    mmoCtx.redisReady = true;
    console.log("Redis connected.");
  } catch (e) {
    console.warn("Redis unavailable (MMO auth disabled):", e);
  }

  if (mmoCtx.dbReady && mmoCtx.redisReady) {
    startMmoBackgroundJobs();
    await bootstrapPersistentWorld();
  } else if (IS_PRODUCTION) {
    console.error("FATAL: NODE_ENV=production requires PostgreSQL and Redis. Dev-auth disabled.");
    process.exit(1);
  } else {
    setDevAuthEnabled(true);
    console.warn("MMO dev-auth: sesiones en memoria (sin Postgres/Redis). Ranking no persiste.");
  }

  server.listen(PORT, HOST, () => {
    const bind = HOST === "0.0.0.0" ? "localhost" : HOST;
    console.log(`\n  ⚔  ${BRAND.gameTitle} — ${BRAND.gameSubtitle}  →  http://${bind}:${PORT}`);
    if (API_ONLY) console.log("  Mode: API-only (DF_API_ONLY=1) — viewer static disabled");
    console.log(`  Mundo demo: ${BRAND.worlds[BRAND.defaultWorldSeed]} (seed ${BRAND.defaultWorldSeed})`);
    console.log(`  World: ${WORLD_TILES_X*TILE_SIZE}×${WORLD_TILES_Y*TILE_SIZE}  Macro: ${MACRO_COLS}×${MACRO_ROWS}  Tiles: ${WORLD_TILES_X}×${WORLD_TILES_Y}`);
    console.log(`  Sim: WS /api/sim/ws  (fallback SSE /api/sim/stream)`);
    if (mmoCtx.dbReady && mmoCtx.redisReady) {
      console.log(`  MMO: POST /api/auth/guest  GET /api/profile/me  GET /api/ranking\n`);
    } else if (isDevAuthEnabled()) {
      console.log(`  MMO: dev-auth (memoria) — login OK sin Docker. Para ranking persistente: npm run infra:up && npm run db:migrate\n`);
    } else {
      console.log(`  MMO: auth API disabled — run npm run infra:up && npm run db:migrate\n`);
    }
  });
})();
