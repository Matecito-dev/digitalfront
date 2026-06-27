import type { WorldState } from "../src/sim/worldState.js";
import type { BarbarianGroup, OutpostCamp, PlayerSquad } from "../src/sim/worldState.js";
import { getPlayerCentroid } from "../src/sim/playerSquad.js";
import type { SimEvent } from "../src/sim/events.js";
import { getSquadInCombatWith } from "../src/sim/playerVsPlayer.js";
import { serializeOutposts } from "../src/sim/outpostCamp.js";

/** Macro cells around squad position included in AOI (+1 cell buffer). */
export const AOI_RADIUS = 64;
export const AOI_BUFFER = 1;
export const MOVEMENT_AOI_EXTRA = 15;
export const MAX_OTHER_SQUADS = Number(process.env.DF_MAX_OTHER_SQUADS ?? process.env.VELIS_MAX_OTHER_SQUADS ?? 12);
/** Inside this radius groups update every sim tick (20 Hz). */
export const LOD_NEAR_RADIUS = 32;
/** Far AOI barbarian groups update every N sim ticks (2 Hz at 20 Hz sim). */
export const LOD_FAR_TICK_INTERVAL = 10;
/** Far AOI other player squads update every N sim ticks (4 Hz at 20 Hz sim). */
export const LOD_FAR_OTHER_SQUAD_TICK_INTERVAL = 5;

export interface SerializedBarbGroup {
  id: string;
  name: string;
  archetype: string;
  anchorX: number;
  anchorY: number;
  state: string;
  huntProfileId?: string | null;
  engageTargetId: string | null;
  tx: number;
  ty: number;
  units: {
    id: string;
    name: string;
    type: string;
    hp: number;
    maxHp: number;
    x: number;
    y: number;
  }[];
}

export interface SerializedPlayerSquad {
  profileId: string;
  captainName: string;
  order: string;
  unitOrder: string;
  attackGroupId: string | null;
  attackProfileId: string | null;
  waypoints: { x: number; y: number }[];
  gold: number;
  insideOutpostId: string | null;
  homeOutpostId: string | null;
  wiped: boolean;
  units: {
    id: string;
    type: string;
    name: string;
    hp: number;
    maxHp: number;
    x: number;
    y: number;
    unitOrder?: string;
  }[];
}

export interface SerializedOtherSquad {
  profileId: string;
  captainName: string;
  inCombatWith: string | null;
  units: {
    id: string;
    type: string;
    name: string;
    hp: number;
    maxHp: number;
    x: number;
    y: number;
  }[];
}

export interface SimTickPayload {
  simTimeMs: number;
  season: string;
  phase: string;
  events: SimEvent[];
  movements: object[];
  camps: object[];
  outposts: OutpostCamp[];
  barbarianGroups: SerializedBarbGroup[];
  cities: object[];
}

export function serializePlayerSquad(squad: PlayerSquad | undefined): SerializedPlayerSquad | null {
  if (!squad) return null;
  if (squad.wiped) {
    return {
      profileId: squad.profileId,
      captainName: squad.captainName,
      order: squad.order,
      unitOrder: squad.unitOrder,
      attackGroupId: null,
      attackProfileId: null,
      waypoints: [],
      gold: squad.gold ?? 0,
      insideOutpostId: null,
      homeOutpostId: squad.homeOutpostId,
      wiped: true,
      units: [],
    };
  }
  const alive = squad.units.filter(u => u.hp > 0);
  if (!alive.length) return null;
  return {
    profileId: squad.profileId,
    captainName: squad.captainName,
    order: squad.order,
    unitOrder: squad.unitOrder,
    attackGroupId: squad.attackGroupId,
    attackProfileId: squad.attackProfileId,
    waypoints: squad.waypoints.map(w => ({ x: w.x, y: w.y })),
    gold: squad.gold ?? 0,
    insideOutpostId: squad.insideOutpostId,
    homeOutpostId: squad.homeOutpostId,
    wiped: false,
    units: alive.map(u => ({
      id: u.id,
      type: u.type,
      name: u.name,
      hp: u.hp,
      maxHp: u.maxHp,
      x: u.x,
      y: u.y,
      level: u.level ?? 1,
      xp: u.xp ?? 0,
      unitOrder: u.unitOrder,
    })),
  };
}

export function hashPlayerSquad(squad: SerializedPlayerSquad | null): string {
  return JSON.stringify(squad);
}

export function serializeOtherSquad(squad: PlayerSquad): SerializedOtherSquad | null {
  const base = serializePlayerSquad(squad);
  if (!base) return null;
  return {
    profileId: base.profileId,
    captainName: base.captainName,
    inCombatWith: getSquadInCombatWith(squad),
    units: base.units,
  };
}

export function hashOtherSquad(squad: SerializedOtherSquad): string {
  return JSON.stringify(squad);
}

export function getOtherSquadsFromState(
  state: WorldState,
  excludeProfileId: string,
): SerializedOtherSquad[] {
  const result: SerializedOtherSquad[] = [];
  for (const [profileId, squad] of state.playerSquads) {
    if (profileId === excludeProfileId) continue;
    const serialized = serializeOtherSquad(squad);
    if (serialized) result.push(serialized);
  }
  return result;
}

function squadMacroCentroid(squad: SerializedOtherSquad): { x: number; y: number } {
  if (!squad.units.length) return { x: 0, y: 0 };
  let cx = 0, cy = 0;
  for (const u of squad.units) { cx += u.x; cy += u.y; }
  return { x: cx / squad.units.length, y: cy / squad.units.length };
}

export function serializeBarbarianGroup(g: BarbarianGroup): SerializedBarbGroup {
  return {
    id: g.id,
    name: g.name,
    archetype: g.archetype,
    anchorX: g.anchorX,
    anchorY: g.anchorY,
    state: g.state,
    huntProfileId: g.huntProfileId ?? null,
    engageTargetId: g.engageTargetId ?? null,
    tx: g.tx,
    ty: g.ty,
    units: g.units.filter(u => u.hp > 0).map(u => ({
      id: u.id,
      name: u.name,
      type: u.type,
      hp: u.hp,
      maxHp: u.maxHp,
      x: u.x,
      y: u.y,
    })),
  };
}

export function groupMacroCentroid(g: BarbarianGroup): { x: number; y: number } {
  const alive = g.units.filter(u => u.hp > 0);
  if (!alive.length) return { x: g.anchorX, y: g.anchorY };
  let cx = 0, cy = 0;
  for (const u of alive) { cx += u.x; cy += u.y; }
  return { x: cx / alive.length, y: cy / alive.length };
}

export function macroDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function isInAoi(
  gx: number,
  gy: number,
  squadX: number,
  squadY: number,
  radius = AOI_RADIUS + AOI_BUFFER,
): boolean {
  return macroDistance(gx, gy, squadX, squadY) <= radius;
}

export function shouldSendGroupThisTick(
  dist: number,
  tickCount: number,
): boolean {
  if (dist <= LOD_NEAR_RADIUS) return true;
  return tickCount % LOD_FAR_TICK_INTERVAL === 0;
}

export function shouldSendOtherSquadThisTick(
  dist: number,
  tickCount: number,
): boolean {
  if (dist <= LOD_NEAR_RADIUS) return true;
  return tickCount % LOD_FAR_OTHER_SQUAD_TICK_INTERVAL === 0;
}

export interface AoiClientLike {
  profileId: string | null;
  squadX: number | null;
  squadY: number | null;
}

/** Authoritative AOI anchor from sim centroid (not client pos or order destination). */
export function getClientAoiAnchor(
  client: AoiClientLike,
  simState: WorldState,
): { x: number; y: number } | null {
  if (!client.profileId) {
    return client.squadX != null && client.squadY != null
      ? { x: client.squadX, y: client.squadY }
      : null;
  }
  const squad = simState.playerSquads.get(client.profileId);
  if (!squad || squad.wiped) {
    return client.squadX != null && client.squadY != null
      ? { x: client.squadX, y: client.squadY }
      : null;
  }
  const alive = squad.units.filter(u => u.hp > 0);
  if (!alive.length) return null;
  return getPlayerCentroid(alive);
}

export function syncClientAoiAnchor(client: AoiClientLike, simState: WorldState): void {
  const anchor = getClientAoiAnchor(client, simState);
  if (anchor) {
    client.squadX = anchor.x;
    client.squadY = anchor.y;
  }
}

export function buildMovements(simState: WorldState): object[] {
  const movements: object[] = [];
  for (const group of simState.barbarianGroups.values()) {
    if (group.state === "MARCHING" || group.state === "RETURNING" || group.state === "WANDERING" || group.state === "HUNTING") {
      const alive = group.units.filter(u => u.hp > 0);
      if (!alive.length) continue;
      let cx = 0, cy = 0;
      for (const u of alive) { cx += u.x; cy += u.y; }
      cx /= alive.length; cy /= alive.length;
      const d = Math.hypot(group.tx - cx, group.ty - cy);
      const travelMs = Math.max(1000, (d / 2.5) * 1000);
      movements.push({
        kind: "march",
        fromX: cx, fromY: cy, toX: group.tx, toY: group.ty,
        arrivesAtMs: simState.simTimeMs + travelMs,
        color: 0xf39c12, label: group.name,
        entityId: group.id,
      });
    }
  }
  for (const city of simState.cities.values()) {
    for (const b of city.outgoingBattles) {
      movements.push({
        kind: "attack",
        fromX: b.fromX, fromY: b.fromY, toX: b.toX, toY: b.toY,
        arrivesAtMs: b.arrivesAtMs, color: 0x3498db, label: city.name,
        entityId: city.id,
      });
    }
  }
  return movements;
}

type MovementLike = {
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
};

function movementInAoi(m: MovementLike, squadX: number, squadY: number): boolean {
  const radius = AOI_RADIUS + AOI_BUFFER + MOVEMENT_AOI_EXTRA;
  const points: [number, number][] = [];
  if (typeof m.fromX === "number" && typeof m.fromY === "number") points.push([m.fromX, m.fromY]);
  if (typeof m.toX === "number" && typeof m.toY === "number") points.push([m.toX, m.toY]);
  return points.some(([x, y]) => macroDistance(x, y, squadX, squadY) <= radius);
}

export function filterMovementsForClient(
  movements: object[],
  squadX: number | null,
  squadY: number | null,
): object[] {
  if (squadX == null || squadY == null) return movements;
  return movements.filter(m => movementInAoi(m as MovementLike, squadX, squadY));
}


function eventInvolvesProfile(ev: SimEvent, profileId: string): boolean {
  if (ev.type === "GROUP_DEFEATED") return ev.profileId === profileId;
  if (ev.type === "PLAYER_UNIT_HIT") return false;
  if (ev.type === "PVP_UNIT_HIT") {
    return ev.attackerProfileId === profileId || ev.targetProfileId === profileId;
  }
  if (ev.type === "PVP_COMBAT_BURST") {
    return ev.hits.some(h => h.attackerProfileId === profileId || h.targetProfileId === profileId);
  }
  if (ev.type === "PVP_COMBAT_END") {
    return ev.winnerProfileId === profileId
      || ev.loserProfileId === profileId
      || ev.attackerProfileId === profileId
      || ev.defenderProfileId === profileId;
  }
  return false;
}

export function filterEventsForClient(
  events: SimEvent[],
  squadX: number | null,
  squadY: number | null,
  profileId: string | null,
  groupPositions: Map<string, { x: number; y: number }>,
): SimEvent[] {
  if (squadX == null || squadY == null) return events;

  return events.filter(ev => {
    if (profileId && eventInvolvesProfile(ev, profileId)) return true;

    if (ev.type === "COMBAT_BURST" || ev.type === "BARB_UNIT_HIT") {
      const g = groupPositions.get(ev.type === "COMBAT_BURST" ? ev.hits[0]?.groupId ?? "" : ev.groupId);
      if (g && isInAoi(g.x, g.y, squadX, squadY, AOI_RADIUS + MOVEMENT_AOI_EXTRA)) return true;
      return false;
    }

    if (ev.type === "GROUP_DEFEATED") {
      const g = groupPositions.get(ev.loserGroupId);
      if (g && isInAoi(g.x, g.y, squadX, squadY, AOI_RADIUS + MOVEMENT_AOI_EXTRA)) return true;
      return ev.winnerGroupId === "player" && profileId != null;
    }

    if (ev.type === "PLAYER_UNIT_HIT") {
      const g = groupPositions.get(ev.groupId);
      if (g) return isInAoi(g.x, g.y, squadX, squadY, AOI_RADIUS + MOVEMENT_AOI_EXTRA);
      return false;
    }

    if (ev.type === "PVP_COMBAT_BURST" || ev.type === "PVP_UNIT_HIT" || ev.type === "PVP_COMBAT_END") {
      return profileId != null && eventInvolvesProfile(ev, profileId);
    }

    if (ev.type === "UNIT_LEVEL_UP") {
      return profileId != null && ev.profileId === profileId;
    }

    if (ev.type === "GOLD_GAINED" || ev.type === "GOLD_LOST" || ev.type === "SQUAD_WIPED") {
      return profileId != null && ev.profileId === profileId;
    }

    if (ev.type === "GROUP_ENGAGED" || ev.type === "GROUP_STATE_CHANGED") {
      const g = groupPositions.get(ev.type === "GROUP_ENGAGED" ? ev.groupAId : ev.groupId);
      if (g) return isInAoi(g.x, g.y, squadX, squadY);
    }

    return true;
  });
}

export function buildGroupPositionIndex(simState: WorldState): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  for (const g of simState.barbarianGroups.values()) {
    map.set(g.id, groupMacroCentroid(g));
  }
  return map;
}

const SPATIAL_CELL = 16;

export class SpatialGridIndex<T> {
  private cells = new Map<string, T[]>();

  private key(col: number, row: number): string {
    return `${col},${row}`;
  }

  clear(): void {
    this.cells.clear();
  }

  insert(x: number, y: number, item: T): void {
    const col = Math.floor(x / SPATIAL_CELL);
    const row = Math.floor(y / SPATIAL_CELL);
    const k = this.key(col, row);
    const bucket = this.cells.get(k);
    if (bucket) bucket.push(item);
    else this.cells.set(k, [item]);
  }

  queryRadius(x: number, y: number, radius: number): T[] {
    const rCells = Math.ceil(radius / SPATIAL_CELL);
    const cx = Math.floor(x / SPATIAL_CELL);
    const cy = Math.floor(y / SPATIAL_CELL);
    const out: T[] = [];
    for (let dc = -rCells; dc <= rCells; dc++) {
      for (let dr = -rCells; dr <= rCells; dr++) {
        const bucket = this.cells.get(this.key(cx + dc, cy + dr));
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  }
}

function otherSquadPriority(
  squad: SerializedOtherSquad,
  viewerProfileId: string,
  squadX: number,
  squadY: number,
): number {
  let score = 0;
  if (squad.inCombatWith === viewerProfileId) score += 1000;
  else if (squad.inCombatWith) score += 500;
  const c = squadMacroCentroid(squad);
  score -= macroDistance(c.x, c.y, squadX, squadY);
  return score;
}

export function capOtherSquads(
  squads: SerializedOtherSquad[],
  viewerProfileId: string,
  squadX: number,
  squadY: number,
  max = MAX_OTHER_SQUADS,
): SerializedOtherSquad[] {
  if (squads.length <= max) return squads;
  return [...squads]
    .sort((a, b) => otherSquadPriority(b, viewerProfileId, squadX, squadY)
      - otherSquadPriority(a, viewerProfileId, squadX, squadY))
    .slice(0, max);
}

export function buildTickPayload(simState: WorldState, events: SimEvent[]): SimTickPayload {
  return {
    simTimeMs: simState.simTimeMs,
    season: simState.season.currentSeason,
    phase: simState.season.phase,
    events,
    movements: buildMovements(simState),
    camps: [],
    outposts: serializeOutposts(simState),
    barbarianGroups: [...simState.barbarianGroups.values()]
      .map(serializeBarbarianGroup)
      .filter(g => g.units.length > 0),
    cities: [...simState.cities.values()].map(c => ({
      id: c.id, name: c.name, botProfile: c.botProfile,
      x: c.x, y: c.y, level: c.level,
      gold: Math.round(c.gold), lastDecision: c.lastDecisionReason,
    })),
  };
}

export function filterGroupsForClient(
  groups: SerializedBarbGroup[],
  squadX: number | null,
  squadY: number | null,
  tickCount: number,
): { visible: SerializedBarbGroup[]; removed: string[] } {
  if (squadX == null || squadY == null) {
    return { visible: groups, removed: [] };
  }

  const visible: SerializedBarbGroup[] = [];
  for (const g of groups) {
    const c = g.units.length
      ? { x: g.units.reduce((s, u) => s + u.x, 0) / g.units.length,
          y: g.units.reduce((s, u) => s + u.y, 0) / g.units.length }
      : { x: g.anchorX, y: g.anchorY };
    const dist = macroDistance(c.x, c.y, squadX, squadY);
    if (!isInAoi(c.x, c.y, squadX, squadY)) continue;
    if (!shouldSendGroupThisTick(dist, tickCount)) continue;
    visible.push(g);
  }
  return { visible, removed: [] };
}

export function hashGroup(g: SerializedBarbGroup): string {
  return JSON.stringify(g);
}

export interface DeltaResult {
  changed: SerializedBarbGroup[];
  removed: string[];
}

/** Compute delta vs last-sent state for one WS client. */
export function computeBarbDelta(
  lastSent: Map<string, string>,
  currentVisible: SerializedBarbGroup[],
  forceFull: boolean,
): DeltaResult {
  const currentIds = new Set(currentVisible.map(g => g.id));
  const removed: string[] = [];
  for (const id of lastSent.keys()) {
    if (!currentIds.has(id)) removed.push(id);
  }

  if (forceFull) {
    for (const g of currentVisible) lastSent.set(g.id, hashGroup(g));
    for (const id of removed) lastSent.delete(id);
    return { changed: currentVisible, removed };
  }

  const changed: SerializedBarbGroup[] = [];
  for (const g of currentVisible) {
    const h = hashGroup(g);
    if (lastSent.get(g.id) !== h) {
      changed.push(g);
      lastSent.set(g.id, h);
    }
  }
  for (const id of removed) lastSent.delete(id);
  return { changed, removed };
}

export function filterOtherSquadsForClient(
  squads: SerializedOtherSquad[],
  squadX: number | null,
  squadY: number | null,
  tickCount: number,
  viewerProfileId?: string,
): { visible: SerializedOtherSquad[] } {
  if (squadX == null || squadY == null) {
    return { visible: squads };
  }

  const visible: SerializedOtherSquad[] = [];
  for (const squad of squads) {
    const c = squadMacroCentroid(squad);
    const dist = macroDistance(c.x, c.y, squadX, squadY);
    if (!isInAoi(c.x, c.y, squadX, squadY)) continue;
    if (!shouldSendOtherSquadThisTick(dist, tickCount)) continue;
    visible.push(squad);
  }

  if (viewerProfileId) {
    return { visible: capOtherSquads(visible, viewerProfileId, squadX, squadY) };
  }
  return { visible: capOtherSquads(visible, "", squadX, squadY) };
}

export interface OtherSquadsDeltaResult {
  changed: SerializedOtherSquad[];
  removedProfileIds: string[];
}

/** Compute delta vs last-sent state for other player squads (keyed by profileId). */
export function computeOtherSquadsDelta(
  lastSent: Map<string, string>,
  currentVisible: SerializedOtherSquad[],
  forceFull: boolean,
): OtherSquadsDeltaResult {
  const currentIds = new Set(currentVisible.map(s => s.profileId));
  const removedProfileIds: string[] = [];
  for (const id of lastSent.keys()) {
    if (!currentIds.has(id)) removedProfileIds.push(id);
  }

  if (forceFull) {
    for (const s of currentVisible) lastSent.set(s.profileId, hashOtherSquad(s));
    for (const id of removedProfileIds) lastSent.delete(id);
    return { changed: currentVisible, removedProfileIds };
  }

  const changed: SerializedOtherSquad[] = [];
  for (const s of currentVisible) {
    const h = hashOtherSquad(s);
    if (lastSent.get(s.profileId) !== h) {
      changed.push(s);
      lastSent.set(s.profileId, h);
    }
  }
  for (const id of removedProfileIds) lastSent.delete(id);
  return { changed, removedProfileIds };
}
