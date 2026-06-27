import type { PlayerSquad, PlayerUnit, WorldState } from "./worldState.js";
import type { SimEvent } from "./events.js";
import {
  getOutpostById,
  isInsideOutpostRadius,
  distanceToOutpost,
} from "./outpostCamp.js";
import {
  HEAL_INSTANT_COST_PER_UNIT,
  RECRUIT_SOLDIER_COST,
  RECRUIT_SNIPER_COST,
  RECOMPOSE_COST_PER_UNIT,
  RESUPPLY_COST,
  spendGold,
} from "./playerEconomy.js";
import { createPlayerSquad, getPlayerCentroid, isSquadAlive } from "./playerSquad.js";
import { initUnitProgression } from "./unitProgression.js";

export type CampAction =
  | "enter"
  | "exit"
  | "heal"
  | "recruit"
  | "recompose"
  | "resupply"
  | "set_home"
  | "respawn";

const SOLDIER_MAX_HP = 120;
const SNIPER_MAX_HP = 70;
const FREE_HEAL_HP_PER_SEC = 2;
const HEAL_DT_MS = 50;

const NAME_FIRST = ["Mateo", "Lucas", "Santiago", "Diego", "Nicolás"];
const NAME_LAST = ["Rodríguez", "García", "Martínez", "López", "González"];

function unitMaxHp(type: PlayerUnit["type"]): number {
  return type === "sniper" ? SNIPER_MAX_HP : SOLDIER_MAX_HP;
}

function placeUnitsInRing(
  units: PlayerUnit[],
  cx: number,
  cy: number,
  radius: number,
): void {
  const alive = units.filter(u => u.hp > 0);
  alive.forEach((u, i) => {
    const angle = (i / Math.max(1, alive.length)) * Math.PI * 2;
    u.x = cx + Math.cos(angle) * radius;
    u.y = cy + Math.sin(angle) * radius;
    u.tx = u.x;
    u.ty = u.y;
    u.formOX = 0;
    u.formOY = 0;
  });
}

function placeUnitsAtCenter(units: PlayerUnit[], cx: number, cy: number): void {
  const offsets: [number, number][] = [
    [0, 0], [-0.5, 0.4], [0.5, 0.4], [-0.3, -0.5], [0.3, -0.5],
  ];
  units.forEach((u, i) => {
    if (u.hp <= 0) return;
    const [ox, oy] = offsets[i] ?? [0, 0];
    u.x = cx + ox;
    u.y = cy + oy;
    u.tx = u.x;
    u.ty = u.y;
  });
}

/** Spawn or deploy squad just outside outpost — ready for field orders. */
export function deploySquadAtOutpostRing(
  state: WorldState,
  squad: PlayerSquad,
  outpostId: string,
): void {
  const outpost = getOutpostById(state, outpostId);
  if (!outpost) return;
  placeUnitsInRing(squad.units, outpost.x, outpost.y, outpost.radius + 1);
  squad.insideOutpostId = null;
  squad.homeOutpostId = outpostId;
  squad.spawnX = outpost.x;
  squad.spawnY = outpost.y;
}

/** Leaving safe zone when issuing move/attack orders from inside an outpost. */
export function leaveOutpostForFieldOrder(state: WorldState, squad: PlayerSquad): void {
  if (!squad.insideOutpostId || squad.wiped) return;
  const outpostId = squad.insideOutpostId;
  deploySquadAtOutpostRing(state, squad, outpostId);
}

function makeRecruit(
  type: PlayerUnit["type"],
  id: string,
  cx: number,
  cy: number,
  captainName: string,
): PlayerUnit {
  const maxHp = unitMaxHp(type);
  const name = type === "soldier" && id === "s1"
    ? captainName
    : `${NAME_FIRST[Math.floor(Math.random() * NAME_FIRST.length)]} ${NAME_LAST[Math.floor(Math.random() * NAME_LAST.length)]}`;
  const u: PlayerUnit = {
    id,
    type,
    name,
    hp: maxHp,
    maxHp,
    x: cx,
    y: cy,
    tx: cx,
    ty: cy,
    cooldownMs: 0,
    moveVel: 0,
    unitOrder: "hold",
    marchMs: 0,
    suppressionMs: 0,
  };
  initUnitProgression(u);
  return u;
}

export interface CampActionResult {
  ok: boolean;
  reason?: string;
  events: SimEvent[];
}

export function canInteractWithOutpost(
  state: WorldState,
  squad: PlayerSquad,
  outpostId: string,
): string | null {
  const outpost = getOutpostById(state, outpostId);
  if (!outpost) return "outpost_not_found";
  if (squad.wiped) return "squad_wiped";
  const c = getPlayerCentroid(squad.units);
  if (squad.insideOutpostId === outpostId) return null;
  if (distanceToOutpost(outpost, c.x, c.y) > outpost.radius + 2) return "too_far";
  return null;
}

export function applyCampAction(
  state: WorldState,
  profileId: string,
  action: CampAction,
  outpostId: string,
  opts?: { soldiers?: number; snipers?: number; instantHeal?: boolean },
): CampActionResult {
  const events: SimEvent[] = [];
  const squad = state.playerSquads.get(profileId);
  if (!squad) return { ok: false, reason: "no_squad", events };

  const outpost = getOutpostById(state, outpostId);
  if (!outpost) return { ok: false, reason: "outpost_not_found", events };

  if (action === "respawn") {
    if (!squad.wiped) return { ok: false, reason: "not_wiped", events };
    const comp = { soldiers: opts?.soldiers ?? 3, snipers: opts?.snipers ?? 2 };
    const newSquad = createPlayerSquad(
      profileId,
      squad.captainName,
      outpost.x,
      outpost.y,
      squad.sessionJoinedAtMs,
      comp,
      {
        gold: squad.gold ?? 0,
        insideOutpostId: outpostId,
        homeOutpostId: squad.homeOutpostId ?? outpostId,
      },
    );
    state.playerSquads.set(profileId, newSquad);
    return { ok: true, events };
  }

  if (squad.wiped) return { ok: false, reason: "squad_wiped", events };

  switch (action) {
    case "enter": {
      const err = canInteractWithOutpost(state, squad, outpostId);
      if (err) return { ok: false, reason: err, events };
      placeUnitsAtCenter(squad.units, outpost.x, outpost.y);
      squad.insideOutpostId = outpostId;
      squad.homeOutpostId = outpostId;
      squad.order = "hold";
      squad.unitOrder = "hold";
      squad.path = [];
      squad.pathIdx = 0;
      squad.waypoints = [];
      squad.attackGroupId = null;
      squad.attackProfileId = null;
      return { ok: true, events };
    }

    case "exit": {
      const insideId = squad.insideOutpostId;
      if (!insideId) {
        return { ok: false, reason: "not_inside", events };
      }
      const exitOutpost = getOutpostById(state, insideId);
      if (!exitOutpost) return { ok: false, reason: "outpost_not_found", events };
      placeUnitsInRing(squad.units, exitOutpost.x, exitOutpost.y, exitOutpost.radius + 1);
      squad.insideOutpostId = null;
      return { ok: true, events };
    }

    case "heal": {
      if (squad.insideOutpostId !== outpostId) {
        return { ok: false, reason: "not_inside", events };
      }
      const alive = squad.units.filter(u => u.hp > 0);
      if (!alive.length) return { ok: false, reason: "no_units", events };

      if (opts?.instantHeal) {
        const damaged = alive.filter(u => u.hp < u.maxHp);
        const cost = damaged.length * HEAL_INSTANT_COST_PER_UNIT;
        if (cost > 0 && !spendGold(squad, cost, "heal_instant", events)) {
          return { ok: false, reason: "insufficient_gold", events };
        }
        for (const u of damaged) u.hp = u.maxHp;
      }
      return { ok: true, events };
    }

    case "recruit": {
      if (squad.insideOutpostId !== outpostId) {
        return { ok: false, reason: "not_inside", events };
      }
      const deadSoldiers = squad.units.filter(u => u.type === "soldier" && u.hp <= 0);
      const deadSnipers = squad.units.filter(u => u.type === "sniper" && u.hp <= 0);
      let cost = deadSoldiers.length * RECRUIT_SOLDIER_COST + deadSnipers.length * RECRUIT_SNIPER_COST;
      if (cost === 0) return { ok: false, reason: "nothing_to_recruit", events };
      if (!spendGold(squad, cost, "recruit", events)) {
        return { ok: false, reason: "insufficient_gold", events };
      }
      for (const u of deadSoldiers) {
        const nu = makeRecruit("soldier", u.id, outpost.x, outpost.y, squad.captainName);
        Object.assign(u, nu);
      }
      for (const u of deadSnipers) {
        const nu = makeRecruit("sniper", u.id, outpost.x, outpost.y, squad.captainName);
        Object.assign(u, nu);
      }
      return { ok: true, events };
    }

    case "recompose": {
      if (squad.insideOutpostId !== outpostId) {
        return { ok: false, reason: "not_inside", events };
      }
      const soldiers = opts?.soldiers ?? 3;
      const snipers = opts?.snipers ?? 2;
      if (soldiers < 1 || soldiers > 4 || snipers < 0 || snipers > 4) {
        return { ok: false, reason: "invalid_composition", events };
      }
      if (soldiers + snipers > 5 || soldiers + snipers < 1) {
        return { ok: false, reason: "invalid_composition", events };
      }
      const currentAlive = squad.units.filter(u => u.hp > 0).length;
      const newTotal = soldiers + snipers;
      const newUnits = Math.max(0, newTotal - currentAlive);
      const cost = newUnits * RECOMPOSE_COST_PER_UNIT;
      if (cost > 0 && !spendGold(squad, cost, "recompose", events)) {
        return { ok: false, reason: "insufficient_gold", events };
      }
      const newSquad = createPlayerSquad(
        profileId,
        squad.captainName,
        outpost.x,
        outpost.y,
        squad.sessionJoinedAtMs,
        { soldiers, snipers },
        {
          gold: squad.gold ?? 0,
          insideOutpostId: outpostId,
          homeOutpostId: squad.homeOutpostId,
        },
      );
      state.playerSquads.set(profileId, newSquad);
      return { ok: true, events };
    }

    case "resupply": {
      if (squad.insideOutpostId !== outpostId) {
        return { ok: false, reason: "not_inside", events };
      }
      if (!spendGold(squad, RESUPPLY_COST, "resupply", events)) {
        return { ok: false, reason: "insufficient_gold", events };
      }
      for (const u of squad.units) {
        if (u.hp <= 0) continue;
        u.marchMs = 0;
        u.suppressionMs = 0;
      }
      return { ok: true, events };
    }

    case "set_home": {
      const err = canInteractWithOutpost(state, squad, outpostId);
      if (err && squad.insideOutpostId !== outpostId) {
        return { ok: false, reason: err, events };
      }
      squad.homeOutpostId = outpostId;
      return { ok: true, events };
    }

    default:
      return { ok: false, reason: "unknown_action", events };
  }
}

export function tickOutpostFreeHeal(state: WorldState, dtSimMs: number): void {
  const healPerTick = FREE_HEAL_HP_PER_SEC * (dtSimMs / 1000);
  if (healPerTick <= 0) return;

  for (const squad of state.playerSquads.values()) {
    if (!squad.insideOutpostId || squad.wiped) continue;
    for (const u of squad.units) {
      if (u.hp <= 0) continue;
      u.hp = Math.min(u.maxHp, u.hp + healPerTick);
    }
  }
}

export function markSquadWiped(
  state: WorldState,
  squad: PlayerSquad,
  killerType: "barbarians" | "player",
  killerName?: string,
  events?: SimEvent[],
): void {
  if (squad.wiped) return;
  squad.wiped = true;
  squad.insideOutpostId = null;
  squad.attackGroupId = null;
  squad.attackProfileId = null;
  squad.order = "hold";
  squad.path = [];
  squad.pathIdx = 0;
  squad.waypoints = [];
  for (const u of squad.units) u.hp = 0;

  events?.push({
    type: "SQUAD_WIPED",
    profileId: squad.profileId,
    killerType,
    killerName,
  });
}

export function checkAndMarkSquadWipes(state: WorldState, events: SimEvent[]): void {
  for (const squad of state.playerSquads.values()) {
    if (squad.wiped) continue;
    if (!isSquadAlive(squad)) {
      const killerType = squad.attackProfileId ? "player" : "barbarians";
      let killerName: string | undefined;
      if (squad.attackProfileId) {
        killerName = state.playerSquads.get(squad.attackProfileId)?.captainName;
      }
      markSquadWiped(state, squad, killerType, killerName, events);
    }
  }
}

export function isUnitInvulnerable(squad: PlayerSquad): boolean {
  return squad.insideOutpostId != null && !squad.wiped;
}
