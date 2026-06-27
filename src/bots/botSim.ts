// Bot simulation adapter: builds BotSnapshot from WorldState and applies decisions in memory.

import type { WorldState, City, BotProfile } from "../sim/worldState.js";
import { nextId } from "../sim/worldState.js";
import type { SimEvent } from "../sim/events.js";
import type { RNG } from "../sim/rng.js";
import { decideBotAction } from "./botDecisionEngine.js";
import { getBotSimulationConfig } from "./botConfigData.js";
const BOT_SIMULATION_CONFIG = getBotSimulationConfig();
import { canAfford } from "../economy/resources.js";
import { getBuildingCost } from "../economy/buildings.js";
import { getUnitCost } from "../economy/units.js";
import { calculateTravelTimeWithMultiplier } from "../economy/battles.js";
import { calculateCampPower } from "../barbarians/barbarianConfigData.js";
import { resolveCityAttack, cityUnitsToRecord } from "../sim/combat.js";

const BOT_DECISION_INTERVAL_MS = 30 * 60_000;  // 30 sim-minutes between decisions

const BOT_ATTACK_RADIUS = 40;   // max cells to target
const BOT_ATTACK_COOLDOWN_MS = 60 * 60_000; // 1 sim-hour between attacks

function buildSnapshot(city: City, state: WorldState): any {
  const nearCities = [...state.cities.values()]
    .filter(c => c.id !== city.id)
    .filter(c => Math.hypot(c.x - city.x, c.y - city.y) <= BOT_ATTACK_RADIUS)
    .map(c => ({
      id: c.id, name: c.name,
      x: c.x, y: c.y,
      estimatedPower: c.level * 100 + c.units.reduce((s, u) => s + u.count * 10, 0),
      incomingAttacks: c.incomingAttacks ?? [],
    }));

  const nearCamps = [...state.camps.values()]
    .filter(c => Math.hypot(c.x - city.x, c.y - city.y) <= BOT_ATTACK_RADIUS)
    .map(c => ({
      id: c.id, name: c.name,
      x: c.x, y: c.y,
      power: calculateCampPower(c.archetype, c.level),
      archetype: c.archetype, level: c.level,
    }));

  return {
    city: {
      id: city.id,
      gold: city.gold, wood: city.wood, stone: city.stone, food: city.food,
      maxGold: city.maxGold, maxWood: city.maxWood, maxStone: city.maxStone, maxFood: city.maxFood,
      power: city.level * 100 + city.units.reduce((s, u) => s + u.count * 10, 0),
    },
    buildings: city.buildings.map(b => ({
      id: b.id, type: b.type, level: b.level,
      isUpgrading: b.completesAtMs != null,
    })),
    units: city.units.map(u => ({ type: u.type, count: u.count })),
    cityTechs: city.techs.map(t => ({ techId: t.techId, level: t.level })),
    activeBuildQueues: city.buildings.filter(b => b.completesAtMs != null),
    activeTrainingQueues: city.units.filter(u => u.completesAtMs != null),
    activeResearch: city.techs.find(t => t.completesAtMs != null) ?? null,
    allianceMembership: null,
    alliances: [],
    marketOffers: [],
    allianceObjectives: [],
    activeOutgoingBattles: city.outgoingBattles,
    targets: nearCities,
    barbarianCamps: nearCamps,
    seasonState: null,
    state: { id: city.id, incomingAttacks: city.incomingAttacks ?? [] },
  };
}

function applyDecision(city: City, decision: any, nowMs: number, state: WorldState): SimEvent[] {
  const events: SimEvent[] = [];

  if (decision.type === "UPGRADE_BUILDING") {
    const btype = decision.payload.buildingType;
    const existing = city.buildings.find(b => b.type === btype);
    const nextLevel = (existing?.level ?? 0) + 1;
    try {
      const cost = getBuildingCost(btype as any, nextLevel);
      if (!canAfford({ gold: city.gold, wood: city.wood, stone: city.stone, food: city.food, gems: 0 }, cost)) return events;
      city.gold -= cost.gold ?? 0; city.wood -= cost.wood ?? 0; city.stone -= cost.stone ?? 0; city.food -= cost.food ?? 0;
      const completesAtMs = nowMs + 60_000;
      if (existing) {
        existing.completesAtMs = completesAtMs;
      } else {
        city.buildings.push({ id: nextId(state), type: btype, level: nextLevel, completesAtMs });
      }
    } catch { /* building config missing */ }
  }

  if (decision.type === "TRAIN_UNITS") {
    const { unitType, count } = decision.payload;
    try {
      const cost = getUnitCost(unitType as any, count);
      const total = { gold: (cost.gold ?? 0), wood: (cost.wood ?? 0), stone: (cost.stone ?? 0), food: (cost.food ?? 0), gems: 0 };
      if (!canAfford({ gold: city.gold, wood: city.wood, stone: city.stone, food: city.food, gems: 0 }, total)) return events;
      city.gold -= total.gold; city.wood -= total.wood; city.stone -= total.stone; city.food -= total.food;
      const existing = city.units.find(u => u.type === unitType);
      const completesAtMs = nowMs + 30 * count * 1000;
      if (existing) { existing.count += count; existing.completesAtMs = completesAtMs; }
      else city.units.push({ type: unitType, count, completesAtMs });
      events.push({ type: "UNITS_TRAINED", cityId: city.id, unitType, count });
    } catch { /* unit config missing */ }
  }

  if (decision.type === "ATTACK_CITY") {
    const targetId = decision.payload?.targetCityId ?? decision.payload?.targetId;
    const target = targetId ? state.cities.get(String(targetId)) : null;
    if (!target) return events;
    if ((city.lastAttackAt ?? 0) + BOT_ATTACK_COOLDOWN_MS > nowMs) return events;
    const totalTroops = city.units.reduce((s, u) => s + u.count, 0);
    if (totalTroops < 5) return events;
    const attackUnits = cityUnitsToRecord(city.units);
    const arrivesAtMs = nowMs + calculateTravelTimeWithMultiplier(city.x, city.y, target.x, target.y, 0.3, 1) * 1000;
    city.outgoingBattles.push({
      targetId: target.id, targetType: "CITY",
      arrivesAtMs, units: city.units.map(u => ({ ...u })),
      fromX: city.x, fromY: city.y, toX: target.x, toY: target.y,
    });
    target.incomingAttacks = target.incomingAttacks ?? [];
    target.incomingAttacks.push({ attackerId: city.id, attackerType: "CITY", arrivesAtMs, fromX: city.x, fromY: city.y });
    city.lastAttackAt = nowMs;
  }

  if (decision.type === "ATTACK_BARBARIAN") {
    const campId = decision.payload?.campId ?? decision.payload?.targetCampId;
    const camp = campId ? state.camps.get(String(campId)) : null;
    if (!camp) return events;
    if ((city.lastAttackAt ?? 0) + BOT_ATTACK_COOLDOWN_MS > nowMs) return events;
    const totalTroops = city.units.reduce((s, u) => s + u.count, 0);
    if (totalTroops < 5) return events;
    const arrivesAtMs = nowMs + calculateTravelTimeWithMultiplier(city.x, city.y, camp.x, camp.y, 0.3, 1) * 1000;
    city.outgoingBattles.push({
      targetId: camp.id, targetType: "CAMP",
      arrivesAtMs, units: city.units.map(u => ({ ...u })),
      fromX: city.x, fromY: city.y, toX: camp.x, toY: camp.y,
    });
    city.lastAttackAt = nowMs;
  }

  return events;
}

function completeQueues(city: City, nowMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (const b of city.buildings) {
    if (b.completesAtMs && nowMs >= b.completesAtMs) {
      b.completesAtMs = undefined;
      events.push({ type: "BUILDING_COMPLETED", cityId: city.id, buildingType: b.type });
    }
  }
  for (const u of city.units) {
    if (u.completesAtMs && nowMs >= u.completesAtMs) delete u.completesAtMs;
  }
  for (const t of city.techs) {
    if (t.completesAtMs && nowMs >= t.completesAtMs) {
      t.completesAtMs = undefined;
      events.push({ type: "RESEARCH_COMPLETED", cityId: city.id, techId: t.techId });
    }
  }
  return events;
}

function tickProduction(city: City, dtMs: number): void {
  const dtHours = dtMs / 3600_000;
  // Simple: gold mine + other buildings produce resources
  const thLevel = city.buildings.find(b => b.type === "TOWN_HALL")?.level ?? 1;
  const goldRate = 60 * thLevel;
  const woodRate = 50 * thLevel;
  const stoneRate = 40 * thLevel;
  const foodRate = 45 * thLevel;
  city.gold = Math.min(city.maxGold, city.gold + goldRate * dtHours);
  city.wood = Math.min(city.maxWood, city.wood + woodRate * dtHours);
  city.stone = Math.min(city.maxStone, city.stone + stoneRate * dtHours);
  city.food = Math.min(city.maxFood, city.food + foodRate * dtHours);
}

export function tickBots(state: WorldState, nowMs: number, dtMs: number, rng: RNG): SimEvent[] {
  const events: SimEvent[] = [];

  for (const city of state.cities.values()) {
    // Resource production
    tickProduction(city, dtMs);

    // Complete queues
    events.push(...completeQueues(city, nowMs));

    // Bot decision
    if (nowMs - city.lastBotDecisionMs < BOT_DECISION_INTERVAL_MS) continue;
    city.lastBotDecisionMs = nowMs;

    // Resolve arrived bot battles
    const arrivedBattles = city.outgoingBattles.filter(b => b.arrivesAtMs <= nowMs);
    city.outgoingBattles = city.outgoingBattles.filter(b => b.arrivesAtMs > nowMs);
    for (const battle of arrivedBattles) {
      if (battle.targetType === "CITY") {
        const defender = state.cities.get(battle.targetId);
        if (defender) {
          const atkUnits = cityUnitsToRecord(battle.units);
          events.push(...resolveCityAttack(state, city, defender, atkUnits, nowMs));
        }
      } else {
        const camp = state.camps.get(battle.targetId);
        if (camp) {
          // Bot vs camp: camp loses proportionally
          const totalAtk = battle.units.reduce((s, u) => s + u.count, 0);
          const campPower = calculateCampPower(camp.archetype, camp.level);
          if (totalAtk > campPower / 15) {
            state.camps.delete(camp.id);
            events.push({ type: "CAMP_DEFEATED", campId: camp.id, name: camp.name, byId: city.id });
          }
          city.lastAttackAt = nowMs;
        }
      }
    }
    // Clean up resolved incomingAttacks
    if (city.incomingAttacks) {
      city.incomingAttacks = city.incomingAttacks.filter(a => a.arrivesAtMs > nowMs);
    }

    const snapshot = buildSnapshot(city, state);
    try {
      const decision = decideBotAction(snapshot, city.botProfile as any, BOT_SIMULATION_CONFIG, new Date(nowMs));
      city.lastDecisionReason = `${decision.type}: ${decision.reason}`;
      events.push(...applyDecision(city, decision, nowMs, state));
    } catch { /* decision engine error — skip */ }
  }

  return events;
}
