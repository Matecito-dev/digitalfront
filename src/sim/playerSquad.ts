import type { TerrainSnapshot } from "./worldState.js";
import type { PlayerOrder, PlayerSquad, PlayerUnit, SquadUnitOrder, WorldState } from "./worldState.js";
import { findPathMacro } from "../barbarians/barbarianPathfinding.js";
import { getTerrainNavGrid, snapToWalkableTerrain, isMacroWalkable } from "../barbarians/barbarianPathfinding.js";
import {
  ARRIVE_DIST,
  getEffectiveSpeed,
  getEffectiveSoldierRange,
  getEffectiveSniperRange,
  hasLineOfSight,
  sampleCell,
  updateVelocityFactor,
} from "../tactics/terrainTactics.js";
import { initUnitProgression, ensureUnitProgression } from "./unitProgression.js";

const WAYPOINT_ARRIVE_DIST = ARRIVE_DIST * 1.35;
const STRAGGLE_CATCHUP_DIST = 1.8;
const STRAGGLE_CATCHUP_MULT = 1.35;

const FORMATION: [number, number][] = [[0, 0], [-0.75, 0.55], [0.75, 0.55], [-0.45, -0.65], [0.45, -0.65]];
const FORMATION_SOLDIER: [number, number][] = [[0, 0.2], [-0.7, 0.55], [0.7, 0.55], [-0.45, -0.2], [0.45, -0.2]];
const FORMATION_SNIPER: [number, number][] = [[-0.55, -0.9], [0.55, -0.9]];

const SOLDIER_MAX_HP = 120;
const SNIPER_MAX_HP = 70;

const NAME_FIRST = [
  "Mateo", "Lucas", "Santiago", "Diego", "Nicolás", "Tomás", "Benjamín", "Joaquín",
  "Bruno", "Martín", "Lautaro", "Facundo", "Gonzalo", "Javier", "Ricardo", "Álvaro",
];
const NAME_LAST = [
  "Rodríguez", "García", "Martínez", "López", "González", "Fernández", "Pérez",
  "Sánchez", "Romero", "Díaz", "Torres", "Ruiz", "Herrera", "Vega", "Morales",
];

function unitMaxHp(type: PlayerUnit["type"]): number {
  return type === "sniper" ? SNIPER_MAX_HP : SOLDIER_MAX_HP;
}

function rotateFormation(lx: number, ly: number, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: lx * (-sin) + ly * cos, y: lx * cos + ly * sin };
}

function assignFormationOffsets(units: PlayerUnit[], destX: number, destY: number): number {
  const center = getPlayerCentroid(units);
  const angle = Math.atan2(destY - center.y, destX - center.x);
  const soldiers = units.filter(u => u.type === "soldier" && u.hp > 0);
  const snipers = units.filter(u => u.type === "sniper" && u.hp > 0);
  soldiers.forEach((u, i) => {
    const [lx, ly] = FORMATION_SOLDIER[Math.min(i, FORMATION_SOLDIER.length - 1)];
    const r = rotateFormation(lx, ly, angle);
    u.formOX = r.x; u.formOY = r.y;
    u.tx = destX + r.x; u.ty = destY + r.y;
    u.facingAngle = angle;
  });
  snipers.forEach((u, i) => {
    const [lx, ly] = FORMATION_SNIPER[Math.min(i, FORMATION_SNIPER.length - 1)];
    const r = rotateFormation(lx, ly, angle);
    u.formOX = r.x; u.formOY = r.y;
    u.tx = destX + r.x; u.ty = destY + r.y;
    u.facingAngle = angle;
  });
  return angle;
}

function syncUnitOrders(squad: PlayerSquad): void {
  const order = squad.unitOrder;
  for (const u of squad.units) {
    if (u.hp <= 0) continue;
    u.unitOrder = order;
  }
}

export function getPlayerCentroid(units: PlayerUnit[]): { x: number; y: number } {
  const alive = units.filter(u => u.hp > 0);
  if (!alive.length) return { x: 0, y: 0 };
  let cx = 0, cy = 0;
  for (const u of alive) { cx += u.x; cy += u.y; }
  return { x: cx / alive.length, y: cy / alive.length };
}

export function isSquadAlive(squad: PlayerSquad): boolean {
  return squad.units.some(u => u.hp > 0);
}

export function createPlayerSquad(
  profileId: string,
  captainName: string,
  centerX: number,
  centerY: number,
  sessionJoinedAtMs = Date.now(),
  composition?: { soldiers: number; snipers: number },
  opts?: {
    gold?: number;
    insideOutpostId?: string | null;
    homeOutpostId?: string | null;
  },
): PlayerSquad {
  const numSoldiers = composition?.soldiers ?? 3;
  const numSnipers = composition?.snipers ?? 2;
  const roster: { id: string; type: PlayerUnit["type"] }[] = [];
  for (let i = 0; i < numSoldiers; i++) {
    roster.push({ id: `s${i + 1}`, type: "soldier" });
  }
  for (let i = 0; i < numSnipers; i++) {
    roster.push({ id: `f${i + 1}`, type: "sniper" });
  }
  const FORMATION_LOCAL: [number, number][] = [
    [0, 0], [-0.75, 0.55], [0.75, 0.55], [-0.45, -0.65], [0.45, -0.65],
    [-0.55, -0.9], [0.55, -0.9],
  ];
  const units: PlayerUnit[] = roster.map((r, i) => {
    const [ox, oy] = FORMATION_LOCAL[Math.min(i, FORMATION_LOCAL.length - 1)]!;
    const x = centerX + ox, y = centerY + oy;
    const maxHp = unitMaxHp(r.type);
    const fi = i % NAME_FIRST.length;
    const li = (i * 3 + 7) % NAME_LAST.length;
    const name = r.id === "s1" ? captainName : `${NAME_FIRST[fi]} ${NAME_LAST[li]}`;
    return {
      ...r,
      name,
      hp: maxHp,
      maxHp,
      x, y, tx: x, ty: y,
      cooldownMs: 0,
      moveVel: 0,
      unitOrder: "hold",
      marchMs: 0,
      suppressionMs: 0,
    };
  });
  for (const u of units) initUnitProgression(u);

  return {
    profileId,
    captainName,
    clientId: profileId,
    units,
    order: "hold",
    unitOrder: "hold",
    targetX: centerX,
    targetY: centerY,
    attackGroupId: null,
    attackProfileId: null,
    path: [],
    pathIdx: 0,
    waypoints: [],
    spawnX: centerX,
    spawnY: centerY,
    sessionJoinedAtMs,
    pvpRetreatSinceMs: null,
    pvpCooldownUntilMs: 0,
    gold: opts?.gold ?? 0,
    insideOutpostId: opts?.insideOutpostId ?? null,
    homeOutpostId: opts?.homeOutpostId ?? null,
    wiped: false,
    combatIntensity: 0,
    lastHitMs: 0,
  };
}

export function ensurePlayerSquad(
  state: WorldState,
  profileId: string,
  captainName: string,
  x: number,
  y: number,
  sessionJoinedAtMs = Date.now(),
): PlayerSquad {
  const existing = state.playerSquads.get(profileId);
  if (existing && isSquadAlive(existing)) return existing;

  if (existing) state.playerSquads.delete(profileId);

  const squad = createPlayerSquad(profileId, captainName, x, y, sessionJoinedAtMs);
  state.playerSquads.set(profileId, squad);
  return squad;
}

function unitShouldHold(u: PlayerUnit, squad: PlayerSquad): boolean {
  const o = u.unitOrder ?? squad.unitOrder;
  return o === "hold" || squad.order === "hold";
}

function advanceSquadPathIndex(squad: PlayerSquad): void {
  if (!squad.path.length) return;
  const center = getPlayerCentroid(squad.units);
  while (squad.pathIdx < squad.path.length) {
    const wp = squad.path[squad.pathIdx];
    const isLast = squad.pathIdx >= squad.path.length - 1;
    const threshold = isLast ? ARRIVE_DIST : WAYPOINT_ARRIVE_DIST;
    if (Math.hypot(wp.x - center.x, wp.y - center.y) > threshold) break;
    squad.pathIdx++;
  }
}

function playerInFireRange(u: PlayerUnit, squad: PlayerSquad, state: WorldState): boolean {
  if (squad.attackProfileId) return false;
  if (!squad.attackGroupId) return false;
  const group = state.barbarianGroups.get(squad.attackGroupId);
  if (!group) return false;
  const enemies = group.units.filter(e => e.hp > 0);
  if (!enemies.length) return false;
  const grid = getTerrainNavGrid(state.terrain);
  const range = u.type === "sniper"
    ? getEffectiveSniperRange(u.x, u.y, grid)
    : getEffectiveSoldierRange(u.x, u.y, grid);
  for (const e of enemies) {
    const d = Math.hypot(e.x - u.x, e.y - u.y);
    if (d <= range + 0.5) return true;
  }
  return false;
}

function resolveSquadMoveTarget(squad: PlayerSquad, state: WorldState): void {
  if (squad.attackProfileId) {
    const enemy = state.playerSquads.get(squad.attackProfileId);
    if (enemy && isSquadAlive(enemy)) {
      const ec = getPlayerCentroid(enemy.units);
      squad.targetX = ec.x;
      squad.targetY = ec.y;
    } else {
      squad.attackProfileId = null;
    }
  }

  if (squad.waypoints.length) {
    const next = squad.waypoints[0];
    const center = getPlayerCentroid(squad.units);
    if (Math.hypot(next.x - center.x, next.y - center.y) <= WAYPOINT_ARRIVE_DIST) {
      squad.waypoints.shift();
      squad.path = [];
      squad.pathIdx = 0;
    }
    if (squad.waypoints.length) {
      squad.targetX = squad.waypoints[0].x;
      squad.targetY = squad.waypoints[0].y;
    }
  }
}

function ensureSquadPath(squad: PlayerSquad, state: WorldState): void {
  const alive = squad.units.filter(u => u.hp > 0);
  if (!alive.length) return;
  if (squad.order === "hold" && squad.unitOrder === "hold") return;

  const center = getPlayerCentroid(alive);
  const needsPath = !squad.path.length
    || squad.pathIdx >= squad.path.length
    || Math.hypot(
      (squad.path[squad.path.length - 1]?.x ?? 0) - squad.targetX,
      (squad.path[squad.path.length - 1]?.y ?? 0) - squad.targetY,
    ) > 2;

  if (needsPath && Math.hypot(squad.targetX - center.x, squad.targetY - center.y) > ARRIVE_DIST) {
    squad.path = findPathMacro(state.terrain, center.x, center.y, squad.targetX, squad.targetY);
    squad.pathIdx = 0;
    assignFormationOffsets(alive, squad.targetX, squad.targetY);
  }
}

export function applyPlayerOrder(
  squad: PlayerSquad,
  order: PlayerOrder,
  targetX: number,
  targetY: number,
  attackGroupId: string | null,
  terrain: TerrainSnapshot,
  opts?: {
    attackProfileId?: string | null;
    unitOrder?: SquadUnitOrder;
    appendWaypoint?: boolean;
  },
): void {
  squad.order = order;
  squad.attackGroupId = order === "attack" ? attackGroupId : null;
  if (order === "attack_pvp") {
    squad.attackProfileId = opts?.attackProfileId ?? null;
    squad.attackGroupId = null;
  } else if (order !== "attack") {
    squad.attackProfileId = null;
  }

  if (opts?.unitOrder) {
    squad.unitOrder = opts.unitOrder;
  } else if (order === "fire_hold") {
    squad.unitOrder = "fire_hold";
  } else if (order === "stealth") {
    squad.unitOrder = "stealth";
  } else if (order === "attack_move") {
    squad.unitOrder = "attack_move";
  } else if (order === "hold") {
    squad.unitOrder = "hold";
  } else if (order === "move" || order === "attack" || order === "attack_pvp") {
    squad.unitOrder = order === "attack" || order === "attack_pvp" ? "attack_move" : "move";
  }

  syncUnitOrders(squad);

  if (order === "hold" || squad.unitOrder === "hold") {
    squad.path = [];
    squad.pathIdx = 0;
    squad.waypoints = [];
    for (const u of squad.units) {
      if (u.hp <= 0) continue;
      u.tx = u.x; u.ty = u.y;
      u.moveVel = 0;
      u.marchMs = 0;
    }
    const c = getPlayerCentroid(squad.units);
    squad.targetX = c.x;
    squad.targetY = c.y;
    return;
  }

  if (opts?.appendWaypoint) {
    squad.waypoints.push({ x: targetX, y: targetY });
    if (squad.waypoints.length === 1) {
      squad.targetX = targetX;
      squad.targetY = targetY;
    }
  } else {
    squad.waypoints = [{ x: targetX, y: targetY }];
    squad.targetX = targetX;
    squad.targetY = targetY;
  }

  const alive = squad.units.filter(u => u.hp > 0);
  if (!alive.length) return;

  const center = getPlayerCentroid(alive);
  squad.path = findPathMacro(terrain, center.x, center.y, targetX, targetY);
  squad.pathIdx = 0;
  assignFormationOffsets(alive, targetX, targetY);
}

export const UNSTUCK_COOLDOWN_MS = 15_000;
export const UNSTUCK_SEARCH_RADIUS = 32;
export const UNSTUCK_AUTO_RADIUS = 8;

/** Count units on non-walkable terrain (mountain/water). */
export function countStuckUnits(squad: PlayerSquad, terrain: TerrainSnapshot): number {
  const grid = getTerrainNavGrid(terrain);
  let n = 0;
  for (const u of squad.units) {
    if (u.hp <= 0) continue;
    if (!isMacroWalkable(grid, u.x, u.y)) n++;
  }
  return n;
}

/** Snap stuck units to nearest walkable cell; returns units relocated. */
export function unstuckPlayerSquad(
  squad: PlayerSquad,
  terrain: TerrainSnapshot,
  maxRadius = UNSTUCK_SEARCH_RADIUS,
): number {
  if (squad.wiped || squad.insideOutpostId) return 0;
  const grid = getTerrainNavGrid(terrain);
  let moved = 0;
  for (const u of squad.units) {
    if (u.hp <= 0) continue;
    const snap = snapToWalkableTerrain(grid, u.x, u.y, maxRadius);
    if (snap.moved) {
      u.x = snap.x;
      u.y = snap.y;
      u.tx = snap.x;
      u.ty = snap.y;
      u.moveVel = 0;
      moved++;
    }
  }
  if (moved > 0) {
    squad.path = [];
    squad.pathIdx = 0;
    squad.waypoints = [];
    const c = getPlayerCentroid(squad.units.filter(u => u.hp > 0));
    squad.targetX = c.x;
    squad.targetY = c.y;
  }
  return moved;
}

function autoUnstuckUnitIfNeeded(
  u: PlayerUnit,
  grid: ReturnType<typeof getTerrainNavGrid>,
): void {
  if (!isMacroWalkable(grid, u.x, u.y)) {
    const snap = snapToWalkableTerrain(grid, u.x, u.y, UNSTUCK_AUTO_RADIUS);
    if (snap.moved) {
      u.x = snap.x;
      u.y = snap.y;
      u.tx = snap.x;
      u.ty = snap.y;
      u.moveVel = 0;
    }
  }
}

const SQUAD_REPULSION_RADIUS = 3;

function applyPlayerSquadRepulsion(squad: PlayerSquad, allSquads: Iterable<PlayerSquad>): void {
  if (squad.order === "hold" && squad.unitOrder === "hold") return;
  const alive = squad.units.filter(u => u.hp > 0);
  if (!alive.length) return;
  const center = getPlayerCentroid(alive);
  let pushX = 0, pushY = 0;
  for (const other of allSquads) {
    if (other.profileId === squad.profileId) continue;
    const otherAlive = other.units.filter(u => u.hp > 0);
    if (!otherAlive.length) continue;
    const oc = getPlayerCentroid(otherAlive);
    const d = Math.hypot(center.x - oc.x, center.y - oc.y);
    if (d < SQUAD_REPULSION_RADIUS && d > 0.01) {
      const push = (SQUAD_REPULSION_RADIUS - d) * 0.12;
      pushX += (center.x - oc.x) / d * push;
      pushY += (center.y - oc.y) / d * push;
    }
  }
  if (Math.abs(pushX) < 0.001 && Math.abs(pushY) < 0.001) return;
  for (const u of alive) {
    u.x += pushX;
    u.y += pushY;
    u.tx += pushX;
    u.ty += pushY;
  }
}

function tickUnitMovement(
  u: PlayerUnit,
  squad: PlayerSquad,
  state: WorldState,
  dtSimMs: number,
  dtSec: number,
  grid: ReturnType<typeof getTerrainNavGrid>,
): void {
  if (u.suppressionMs && u.suppressionMs > 0) {
    u.suppressionMs = Math.max(0, u.suppressionMs - dtSimMs);
  }

  autoUnstuckUnitIfNeeded(u, grid);

  if (unitShouldHold(u, squad)) {
    u.tx = u.x; u.ty = u.y;
    u.moveVel = 0;
    u.marchMs = 0;
    return;
  }

  const inFireRange = playerInFireRange(u, squad, state);
  const fireHold = (u.unitOrder ?? squad.unitOrder) === "fire_hold";
  if (inFireRange && (fireHold || squad.order === "attack")) {
    u.tx = u.x; u.ty = u.y;
    u.moveVel = 0;
    return;
  }

  let targetX = u.tx;
  let targetY = u.ty;
  if (squad.pathIdx < squad.path.length) {
    const wp = squad.path[squad.pathIdx];
    targetX = wp.x + (u.formOX ?? 0);
    targetY = wp.y + (u.formOY ?? 0);
  }

  const dx = targetX - u.x;
  const dy = targetY - u.y;
  const dist = Math.hypot(dx, dy);
  const wantsMove = dist >= 0.04;
  u.moveVel = updateVelocityFactor(u.moveVel ?? 0, wantsMove, dtSec);

  if (!wantsMove) {
    if (squad.pathIdx < squad.path.length - 1) {
      // centroid advances path; units follow on next ticks
    }
    return;
  }

  const cell = sampleCell(grid, u.x, u.y);
  const stealth = (u.unitOrder ?? squad.unitOrder) === "stealth";
  const holding = unitShouldHold(u, squad);
  if (wantsMove && !holding) u.marchMs = (u.marchMs ?? 0) + dtSimMs;
  else u.marchMs = 0;

  let speed = getEffectiveSpeed(u.type, cell.kind, cell.height, 0, u.moveVel ?? 0, {
    stealth,
    marchMs: u.marchMs,
    holding,
  });

  const lag = Math.hypot(u.tx - u.x, u.ty - u.y);
  if (lag > STRAGGLE_CATCHUP_DIST) speed *= STRAGGLE_CATCHUP_MULT;

  const step = Math.min(dist, speed * dtSec);
  u.x += (dx / dist) * step;
  u.y += (dy / dist) * step;
  u.facingAngle = Math.atan2(dy, dx);
}

export function tickPlayerSquadMovement(state: WorldState, squad: PlayerSquad, dtSimMs: number): void {
  if (squad.wiped || squad.insideOutpostId) return;
  const alive = squad.units.filter(u => u.hp > 0);
  if (!alive.length) return;

  if (squad.order !== "hold" || squad.unitOrder !== "hold") {
    resolveSquadMoveTarget(squad, state);
    ensureSquadPath(squad, state);
    advanceSquadPathIndex(squad);
  }

  const dtSec = dtSimMs / 1000;
  const grid = getTerrainNavGrid(state.terrain);

  for (const u of alive) {
    tickUnitMovement(u, squad, state, dtSimMs, dtSec, grid);
  }

  applyPlayerSquadRepulsion(squad, state.playerSquads.values());
}

export function tickAllPlayerSquads(state: WorldState, dtSimMs: number): void {
  for (const squad of state.playerSquads.values()) {
    tickPlayerSquadMovement(state, squad, dtSimMs);
  }
}
