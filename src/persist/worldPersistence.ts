import type pg from "pg";
import type {
  BarbarianCamp,
  BarbarianGroup,
  City,
  OutpostCamp,
  WorldState,
} from "../sim/worldState.js";
import type { SimEvent } from "../sim/events.js";
import type { RNG } from "../sim/rng.js";
import { tick, simDtMs } from "../sim/simEngine.js";

export const PERSIST_SCHEMA_VERSION = 1;
export const CHECKPOINT_INTERVAL_MS = 5 * 60_000;
export const MAX_OFFLINE_SIM_MS = 6 * 60 * 60 * 1000;
export const OFFLINE_TICK_DIVISOR = 10;

export interface SerializableWorldSnapshot {
  version: number;
  simTimeMs: number;
  nextId: number;
  season: WorldState["season"];
  usedBarbarianNames: string[];
  spawnHints?: WorldState["spawnHints"];
  camps: BarbarianCamp[];
  outposts: OutpostCamp[];
  cities: City[];
  barbarianGroups: BarbarianGroup[];
}

export interface WorldRow {
  id: string;
  seed: string;
  shard_id: string;
  display_name: string;
  sim_time_ms: string;
  season: string;
  phase: string;
  last_tick_at: Date;
}

export function serializeWorldState(state: WorldState): SerializableWorldSnapshot {
  return {
    version: PERSIST_SCHEMA_VERSION,
    simTimeMs: state.simTimeMs,
    nextId: state.nextId,
    season: state.season,
    usedBarbarianNames: [...state.usedBarbarianNames],
    spawnHints: state.spawnHints,
    camps: [...state.camps.values()],
    outposts: [...state.outposts.values()],
    cities: [...state.cities.values()],
    barbarianGroups: [...state.barbarianGroups.values()],
  };
}

export function applyWorldSnapshot(state: WorldState, snapshot: SerializableWorldSnapshot): void {
  state.simTimeMs = snapshot.simTimeMs;
  state.nextId = snapshot.nextId;
  state.season = snapshot.season;
  state.usedBarbarianNames = new Set(snapshot.usedBarbarianNames);
  state.spawnHints = snapshot.spawnHints;
  state.camps = new Map(snapshot.camps.map(c => [c.id, c]));
  state.outposts = new Map((snapshot.outposts ?? []).map(o => [o.id, o]));
  state.cities = new Map(snapshot.cities.map(c => [c.id, c]));
  state.barbarianGroups = new Map(snapshot.barbarianGroups.map(g => [g.id, g]));
}

export function computeCatchUpTicks(lastTickAt: Date, nowMs = Date.now()): number {
  const wallGapMs = Math.max(0, nowMs - lastTickAt.getTime());
  const simGapMs = Math.min(wallGapMs, MAX_OFFLINE_SIM_MS);
  return Math.floor(simGapMs / simDtMs(1));
}

export function runCatchUpTicks(
  state: WorldState,
  tickCount: number,
  rng: RNG,
): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < tickCount; i++) {
    events.push(...tick(state, simDtMs(1), rng));
  }
  return events;
}

export function getShardId(): string {
  return process.env.DF_SHARD_ID ?? process.env.VELIS_SHARD_ID ?? "default";
}

export async function getOrCreateWorld(
  pool: pg.Pool,
  seed: string,
  shardId: string,
  displayName: string,
): Promise<WorldRow> {
  const existing = await pool.query<WorldRow>(
    `SELECT id, seed, shard_id, display_name, sim_time_ms, season, phase, last_tick_at
     FROM worlds WHERE seed = $1 AND shard_id = $2`,
    [seed, shardId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const { rows } = await pool.query<WorldRow>(
    `INSERT INTO worlds (seed, shard_id, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, seed, shard_id, display_name, sim_time_ms, season, phase, last_tick_at`,
    [seed, shardId, displayName],
  );
  return rows[0]!;
}

export async function loadLatestCheckpoint(
  pool: pg.Pool,
  worldId: string,
): Promise<SerializableWorldSnapshot | null> {
  const { rows } = await pool.query<{ state_json: SerializableWorldSnapshot }>(
    `SELECT state_json FROM world_checkpoints
     WHERE world_id = $1
     ORDER BY sim_time_ms DESC, created_at DESC
     LIMIT 1`,
    [worldId],
  );
  const snap = rows[0]?.state_json;
  if (!snap || snap.version !== PERSIST_SCHEMA_VERSION) return null;
  return snap;
}

export async function saveCheckpoint(
  pool: pg.Pool,
  worldId: string,
  state: WorldState,
): Promise<void> {
  const snapshot = serializeWorldState(state);
  await pool.query(
    `INSERT INTO world_checkpoints (world_id, sim_time_ms, state_json)
     VALUES ($1, $2, $3::jsonb)`,
    [worldId, state.simTimeMs, JSON.stringify(snapshot)],
  );
  await pool.query(
    `UPDATE worlds
     SET sim_time_ms = $2, season = $3, phase = $4, last_tick_at = now()
     WHERE id = $1`,
    [worldId, state.simTimeMs, state.season.currentSeason, state.season.phase],
  );

  await pool.query(
    `DELETE FROM world_checkpoints
     WHERE world_id = $1
       AND id NOT IN (
         SELECT id FROM world_checkpoints
         WHERE world_id = $1
         ORDER BY sim_time_ms DESC, created_at DESC
         LIMIT 7
       )`,
    [worldId],
  );
}

export async function touchWorldTick(
  pool: pg.Pool,
  worldId: string,
  state: WorldState,
): Promise<void> {
  await pool.query(
    `UPDATE worlds
     SET sim_time_ms = $2, season = $3, phase = $4, last_tick_at = now()
     WHERE id = $1`,
    [worldId, state.simTimeMs, state.season.currentSeason, state.season.phase],
  );
}
