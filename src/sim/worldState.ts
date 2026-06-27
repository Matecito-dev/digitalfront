// In-memory world state for the simulator.
// All entities are plain objects; no DB, no ORM.

import type { TerrainKind } from "../worldgen/worldTerrainConfigData.js";
import type { SeasonState } from "./seasonsMath.js";

// ── Terrain ───────────────────────────────────────────────────────────────────

export interface TerrainSnapshot {
  cells: TerrainKind[];
  heights: Uint8Array;
  hillshade: Uint8Array;
  cols: number;
  rows: number;
  seed: number;
}

// ── Barbarians ────────────────────────────────────────────────────────────────

export type BarbarianArchetype = "RAIDERS" | "HUNTERS" | "MARAUDERS" | "WARHOST" | "NOMADS";

export interface BarbarianArmy {
  id: string;
  infantry: number;
  cavalry: number;
  archers: number;
}

export type BarbarianUnitType = "soldier" | "sniper";
export type BarbarianGroupState = "RESTING" | "WANDERING" | "MARCHING" | "RETURNING" | "ENGAGED" | "HUNTING";

export interface BarbarianUnit {
  id: string;
  name: string;
  type: BarbarianUnitType;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  cooldownMs?: number;
  formOX?: number;
  formOY?: number;
}

export interface BarbarianGroup {
  id: string;
  name: string;
  archetype: BarbarianArchetype;
  /** Elite band leader — 5% spawn, 2× HP on lead unit. */
  isBoss?: boolean;
  /** Punto de ancla donde descansa / se repliega el grupo (sin campamentos). */
  anchorX: number;
  anchorY: number;
  state: BarbarianGroupState;
  units: BarbarianUnit[];
  tx: number;
  ty: number;
  path: { x: number; y: number }[];
  pathIdx: number;
  engageTargetId?: string;
  /** Player squad profileId when state is HUNTING. */
  huntProfileId?: string;
  lastCombatMs?: number;
  /** 0–100 combat frenzy intensity (decays out of combat). */
  combatIntensity?: number;
  lastHitMs?: number;
  /** Player profileId when engaged in PvE combat. */
  engagedPlayerProfileId?: string;
  stateUntilMs: number;
  lastActionMs: number;
  restCount: number;
  fatigue: number;
  /** @deprecated camps removed — kept for event compat */
  homeCampId?: string;
}

export interface BarbarianCamp {
  id: string;
  name: string;
  archetype: BarbarianArchetype;
  level: number;
  x: number;   // world cell col
  y: number;   // world cell row
  army: BarbarianArmy;
  lastActionMs: number;
  lastAttackAt?: number;
  lastGroupRespawnMs?: number;
  attackIntent?: {
    targetCityId: string;
    toX: number;
    toY: number;
    arrivesAtMs: number;
    units: BarbarianArmy;
  };
}

/** Shared neutral outpost — safe zone, services, respawn. */
export interface OutpostCamp {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  safeRadius: number;
  sectorIndex: number;
}

// ── Cities / Bots ─────────────────────────────────────────────────────────────

export type BotProfile = "ECONOMIST" | "MILITARIST" | "TECH_RUSHER" | "BALANCED" | "CHAOTIC";

export interface CityBuilding {
  id: string;
  type: string;
  level: number;
  completesAtMs?: number;  // undefined = complete
}

export interface CityUnit {
  type: string;
  count: number;
  completesAtMs?: number;
}

export interface CityTech {
  techId: string;
  level: number;
  completesAtMs?: number;
}

export interface City {
  id: string;
  name: string;
  botProfile: BotProfile;
  x: number;
  y: number;
  level: number;   // town hall level
  gold: number;
  wood: number;
  stone: number;
  food: number;
  maxGold: number;
  maxWood: number;
  maxStone: number;
  maxFood: number;
  buildings: CityBuilding[];
  units: CityUnit[];
  techs: CityTech[];
  lastBotDecisionMs: number;
  lastDecisionReason?: string;
  lastAttackAt?: number;
  lastAttackedAt?: number;
  incomingAttacks?: Array<{ attackerId: string; attackerType: "CITY" | "CAMP"; arrivesAtMs: number; fromX: number; fromY: number }>;
  outgoingBattles: Array<{ targetId: string; targetType: "CITY" | "CAMP"; arrivesAtMs: number; units: CityUnit[]; fromX: number; fromY: number; toX: number; toY: number }>;
}

// ── Player squad (authoritative PvE) ─────────────────────────────────────────

export type PlayerOrder =
  | "move"
  | "hold"
  | "attack"
  | "attack_pvp"
  | "fire_hold"
  | "stealth"
  | "attack_move";

export type SquadUnitOrder = "move" | "hold" | "attack_move" | "fire_hold" | "stealth";

export interface PlayerUnit {
  id: string;
  type: "soldier" | "sniper";
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
  unitOrder?: SquadUnitOrder;
  marchMs?: number;
  suppressionMs?: number;
  facingAngle?: number;
  /** Combat progression 1..10 */
  level?: number;
  xp?: number;
}

export interface PlayerSquad {
  profileId: string;
  captainName: string;
  /** @deprecated use profileId */
  clientId: string;
  units: PlayerUnit[];
  order: PlayerOrder;
  unitOrder: SquadUnitOrder;
  targetX: number;
  targetY: number;
  attackGroupId: string | null;
  /** Active PvP target — at most one concurrent engagement per squad. */
  attackProfileId: string | null;
  path: { x: number; y: number }[];
  pathIdx: number;
  waypoints: { x: number; y: number }[];
  /** Personal spawn — center of PvP safe zone (15 cells). */
  spawnX: number;
  spawnY: number;
  /** Wall-clock ms when squad joined this session (grace period for PvP). */
  sessionJoinedAtMs: number;
  /** Sim ms when squad retreated beyond 2× combat range — cancel PvP after 5s. */
  pvpRetreatSinceMs: number | null;
  /** Cooldown before re-engaging PvP after wipe (sim ms). */
  pvpCooldownUntilMs: number;
  /** Player wallet (authoritative in session). */
  gold: number;
  /** null = in field; set when inside outpost safe zone. */
  insideOutpostId: string | null;
  /** Preferred outpost for respawn. */
  homeOutpostId: string | null;
  /** Squad wiped — awaiting respawn at camp. */
  wiped: boolean;
  /** Sim ms — manual unstuck cooldown. */
  unstuckCooldownUntilMs?: number;
  /** 0–100 combat frenzy intensity (decays out of combat). */
  combatIntensity?: number;
  lastHitMs?: number;
}

// ── World State ───────────────────────────────────────────────────────────────

export interface SpawnHints {
  pois: { x: number; y: number }[];
}

export interface WorldState {
  seed: number;
  simTimeMs: number;        // current simulation time in ms (accelerated)
  realStartMs: number;      // real wall-clock ms when sim started (for SSE timing)
  speedMultiplier: number;  // 1x=realtime, 60=1min/sec, 3600=1hr/sec
  paused: boolean;

  terrain: TerrainSnapshot;
  season: SeasonState;

  camps: Map<string, BarbarianCamp>;
  /** Shared neutral outposts (not legacy barbarian camps). */
  outposts: Map<string, OutpostCamp>;
  cities: Map<string, City>;
  barbarianGroups: Map<string, BarbarianGroup>;
  usedBarbarianNames: Set<string>;
  playerSquads: Map<string, PlayerSquad>;
  /** POI/región hints for barbarian spawn (from WorldMeta at sim init). */
  spawnHints?: SpawnHints;

  nextId: number;           // auto-increment for unique IDs
}

export function nextId(state: WorldState): string {
  return String(state.nextId++);
}
