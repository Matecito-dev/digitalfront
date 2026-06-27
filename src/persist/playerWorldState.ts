import type pg from "pg";
import type { PlayerSquad, PlayerUnit, SquadUnitOrder } from "../sim/worldState.js";
import { createPlayerSquad, getPlayerCentroid, isSquadAlive } from "../sim/playerSquad.js";
import { ensureUnitProgression } from "../sim/unitProgression.js";

export interface SerializedPlayerSquad {
  profileId: string;
  captainName: string;
  order: PlayerSquad["order"];
  unitOrder: SquadUnitOrder;
  targetX: number;
  targetY: number;
  attackGroupId: string | null;
  attackProfileId: string | null;
  path: { x: number; y: number }[];
  pathIdx: number;
  waypoints: { x: number; y: number }[];
  spawnX: number;
  spawnY: number;
  pvpCooldownUntilMs: number;
  gold?: number;
  insideOutpostId?: string | null;
  homeOutpostId?: string | null;
  wiped?: boolean;
  units: Array<{
    id: string;
    type: PlayerUnit["type"];
    name: string;
    hp: number;
    maxHp: number;
    x: number;
    y: number;
    tx: number;
    ty: number;
    formOX?: number;
    formOY?: number;
    cooldownMs?: number;
    moveVel?: number;
    level?: number;
    xp?: number;
  }>;
}

export interface PlayerWorldStateRow {
  world_id: string;
  profile_id: string;
  squad_json: SerializedPlayerSquad | null;
  fog_blob: Buffer | null;
  last_x: number | null;
  last_y: number | null;
  gold: number;
  home_outpost_id: string | null;
  disconnected_at: Date | null;
  updated_at: Date;
}

export function serializeSquad(squad: PlayerSquad): SerializedPlayerSquad {
  return {
    profileId: squad.profileId,
    captainName: squad.captainName,
    order: squad.order,
    unitOrder: squad.unitOrder,
    targetX: squad.targetX,
    targetY: squad.targetY,
    attackGroupId: squad.attackGroupId,
    attackProfileId: squad.attackProfileId,
    path: squad.path,
    pathIdx: squad.pathIdx,
    waypoints: squad.waypoints ?? [],
    spawnX: squad.spawnX,
    spawnY: squad.spawnY,
    pvpCooldownUntilMs: squad.pvpCooldownUntilMs ?? 0,
    gold: squad.gold ?? 0,
    insideOutpostId: squad.insideOutpostId,
    homeOutpostId: squad.homeOutpostId,
    wiped: squad.wiped ?? false,
    units: squad.units.map(u => ({
      id: u.id,
      type: u.type,
      name: u.name,
      hp: u.hp,
      maxHp: u.maxHp,
      x: u.x,
      y: u.y,
      tx: u.tx,
      ty: u.ty,
      formOX: u.formOX,
      formOY: u.formOY,
      cooldownMs: u.cooldownMs,
      moveVel: u.moveVel,
      level: u.level ?? 1,
      xp: u.xp ?? 0,
    })),
  };
}

export function deserializeSquad(data: SerializedPlayerSquad): PlayerSquad | null {
  if (!data?.units?.length) return null;
  const squad: PlayerSquad = {
    profileId: data.profileId,
    captainName: data.captainName,
    clientId: data.profileId,
    order: data.order,
    unitOrder: data.unitOrder ?? (data.order === "hold" ? "hold" : "move"),
    targetX: data.targetX,
    targetY: data.targetY,
    attackGroupId: data.attackGroupId,
    attackProfileId: data.attackProfileId ?? null,
    path: data.path ?? [],
    pathIdx: data.pathIdx ?? 0,
    waypoints: data.waypoints ?? [],
    spawnX: data.spawnX ?? data.targetX,
    spawnY: data.spawnY ?? data.targetY,
    sessionJoinedAtMs: Date.now(),
    pvpRetreatSinceMs: null,
    pvpCooldownUntilMs: data.pvpCooldownUntilMs ?? 0,
    gold: data.gold ?? 0,
    insideOutpostId: data.insideOutpostId ?? null,
    homeOutpostId: data.homeOutpostId ?? null,
    wiped: data.wiped ?? false,
    units: data.units.map(u => ({
      id: u.id,
      type: u.type,
      name: u.name,
      hp: u.hp,
      maxHp: u.maxHp,
      x: u.x,
      y: u.y,
      tx: u.tx,
      ty: u.ty,
      formOX: u.formOX,
      formOY: u.formOY,
      cooldownMs: u.cooldownMs ?? 0,
      moveVel: u.moveVel ?? 0,
      level: u.level ?? 1,
      xp: u.xp ?? 0,
    })),
  };
  if (data.wiped || isSquadAlive(squad)) {
    for (const u of squad.units) ensureUnitProgression(u);
    return squad;
  }
  return null;
}

export function decodeFogBlob(blob: Buffer | null): string | null {
  if (!blob || blob.length === 0) return null;
  return blob.toString("base64");
}

export function encodeFogBlob(fogBase64: string | null | undefined): Buffer | null {
  if (!fogBase64) return null;
  try {
    return Buffer.from(fogBase64, "base64");
  } catch {
    return null;
  }
}

export async function savePlayerWorldState(
  pool: pg.Pool,
  worldId: string,
  profileId: string,
  squad: PlayerSquad | null,
  fogBlob: Buffer | null,
  lastX: number,
  lastY: number,
): Promise<void> {
  const squadJson = squad && (isSquadAlive(squad) || squad.wiped) ? serializeSquad(squad) : null;
  const gold = squad?.gold ?? 0;
  const homeOutpostId = squad?.homeOutpostId ?? null;
  await pool.query(
    `INSERT INTO player_world_state
       (world_id, profile_id, squad_json, fog_blob, last_x, last_y, gold, home_outpost_id, disconnected_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, now(), now())
     ON CONFLICT (world_id, profile_id) DO UPDATE SET
       squad_json = EXCLUDED.squad_json,
       fog_blob = COALESCE(EXCLUDED.fog_blob, player_world_state.fog_blob),
       last_x = EXCLUDED.last_x,
       last_y = EXCLUDED.last_y,
       gold = EXCLUDED.gold,
       home_outpost_id = EXCLUDED.home_outpost_id,
       disconnected_at = now(),
       updated_at = now()`,
    [
      worldId,
      profileId,
      squadJson ? JSON.stringify(squadJson) : null,
      fogBlob,
      lastX,
      lastY,
      gold,
      homeOutpostId,
    ],
  );
}

export async function loadPlayerWorldState(
  pool: pg.Pool,
  worldId: string,
  profileId: string,
): Promise<{
  squad: PlayerSquad | null;
  fogBlob: string | null;
  lastX: number | null;
  lastY: number | null;
  gold: number;
  homeOutpostId: string | null;
  hasProgress: boolean;
} | null> {
  const { rows } = await pool.query<PlayerWorldStateRow>(
    `SELECT world_id, profile_id, squad_json, fog_blob, last_x, last_y,
            COALESCE(gold, 0) AS gold, home_outpost_id, disconnected_at, updated_at
     FROM player_world_state
     WHERE world_id = $1 AND profile_id = $2`,
    [worldId, profileId],
  );
  const row = rows[0];
  if (!row) return null;

  let squad = row.squad_json ? deserializeSquad(row.squad_json) : null;
  if (squad) {
    squad.gold = row.gold ?? squad.gold ?? 0;
    if (row.home_outpost_id) squad.homeOutpostId = row.home_outpost_id;
  }
  return {
    squad,
    fogBlob: decodeFogBlob(row.fog_blob),
    lastX: row.last_x,
    lastY: row.last_y,
    gold: row.gold ?? 0,
    homeOutpostId: row.home_outpost_id,
    hasProgress: !!(row.squad_json || row.fog_blob || row.last_x != null),
  };
}

export async function hasPlayerWorldProgress(
  pool: pg.Pool,
  worldId: string,
  profileId: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM player_world_state
       WHERE world_id = $1 AND profile_id = $2
         AND (squad_json IS NOT NULL OR fog_blob IS NOT NULL)
     ) AS exists`,
    [worldId, profileId],
  );
  return rows[0]?.exists ?? false;
}

export function squadCentroidOrNull(squad: PlayerSquad | null): { x: number; y: number } | null {
  if (!squad || !isSquadAlive(squad)) return null;
  return getPlayerCentroid(squad.units);
}

export function restoreOrCreateSquad(
  saved: PlayerSquad | null,
  profileId: string,
  captainName: string,
  spawnX: number,
  spawnY: number,
  sessionJoinedAtMs = Date.now(),
  outpostId?: string,
  gold = 0,
  homeOutpostId?: string | null,
): { squad: PlayerSquad; restored: boolean; wiped: boolean } {
  if (saved?.wiped) {
    saved.captainName = captainName;
    saved.gold = saved.gold ?? gold;
    return { squad: saved, restored: true, wiped: true };
  }
  if (saved && isSquadAlive(saved)) {
    saved.captainName = captainName;
    saved.unitOrder ??= saved.order === "hold" ? "hold" : "move";
    saved.attackProfileId ??= null;
    saved.waypoints ??= [];
    saved.spawnX ??= spawnX;
    saved.spawnY ??= spawnY;
    saved.sessionJoinedAtMs = sessionJoinedAtMs;
    saved.pvpRetreatSinceMs ??= null;
    saved.pvpCooldownUntilMs ??= 0;
    saved.gold ??= gold;
    saved.insideOutpostId ??= null;
    saved.homeOutpostId ??= homeOutpostId ?? null;
    saved.wiped ??= false;
    const captain = saved.units.find(u => u.id === "s1");
    if (captain) captain.name = captainName;
    for (const u of saved.units) ensureUnitProgression(u);
    return { squad: saved, restored: true, wiped: false };
  }
  const squad = createPlayerSquad(
    profileId,
    captainName,
    spawnX,
    spawnY,
    sessionJoinedAtMs,
    undefined,
    {
      gold,
      insideOutpostId: outpostId ?? null,
      homeOutpostId: homeOutpostId ?? outpostId ?? null,
    },
  );
  return { squad, restored: false, wiped: false };
}
