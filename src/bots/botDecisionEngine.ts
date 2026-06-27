import type { BuildingType, UnitType, Resources } from "../shared/economy.js";
import { getBuildingCost, getBuildingMaxLevelForTownHall } from "../economy/buildings.js";
import { canAfford } from "../economy/resources.js";
import { getAllTechConfigs, canResearch, getResearchCost } from "../economy/techs.js";
import { getUnlockedUnits, getUnitCost } from "../economy/units.js";
import type { BotProfile, BotSimulationConfig } from "./botConfigData.js";
import { getCityQueueConfig } from "../economy/queueConfigData.js";

const UNLOCK_TECHS = ["HORSE_BREEDING", "SIEGE_ENGINEERING", "SPY_NETWORK"];

const MARKET_FEE_RATE = 0.05;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = seed % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
    seed = Math.floor(seed / (i + 1));
  }
  return a;
}

function techPrefScore(category: string, profile: BotProfile): number {
  if (profile === "MILITARIST") return category === "MILITARY" ? 2 : category === "ECONOMY" ? 1 : 0;
  if (profile === "TECH_RUSHER") return category === "MILITARY" ? 2 : category === "DEFENSE" ? 2 : 1;
  if (profile === "ECONOMIST") return category === "ECONOMY" ? 2 : 1;
  return 1;
}

export type BotActionType = "UPGRADE_BUILDING" | "TRAIN_UNITS" | "START_RESEARCH" | "ATTACK_CITY" | "ATTACK_BARBARIAN" | "SEND_RESOURCES" | "CREATE_MARKET_OFFER" | "ACCEPT_MARKET_OFFER" | "CONTRIBUTE_ALLIANCE_OBJECTIVE" | "SCOUT_TARGET" | "IDLE";
export type BotSocialActionType = "CREATE_ALLIANCE" | "JOIN_ALLIANCE" | "SEND_CHAT" | "SEND_MAIL";

export type BotDecision =
  | { type: "UPGRADE_BUILDING"; reason: string; payload: { buildingId: string; buildingType: BuildingType }; score: number }
  | { type: "TRAIN_UNITS"; reason: string; payload: { unitType: UnitType; count: number }; score: number }
  | { type: "START_RESEARCH"; reason: string; payload: { techId: string }; score: number }
  | { type: "ATTACK_CITY"; reason: string; payload: { targetCityId: string; units: Array<{ type: UnitType; count: number }> }; score: number }
  | { type: "ATTACK_BARBARIAN"; reason: string; payload: { targetCampId: string; units: Array<{ type: UnitType; count: number }> }; score: number }
  | { type: "SEND_RESOURCES"; reason: string; payload: { recipientCityId: string; resources: Resources }; score: number }
  | { type: "CREATE_MARKET_OFFER"; reason: string; payload: { cityId: string; giveResource: "gold" | "wood" | "stone" | "food"; giveAmount: number; wantResource: "gold" | "wood" | "stone" | "food"; wantAmount: number }; score: number }
  | { type: "ACCEPT_MARKET_OFFER"; reason: string; payload: { offerId: string; cityId: string }; score: number }
  | { type: "CONTRIBUTE_ALLIANCE_OBJECTIVE"; reason: string; payload: { objectiveId: string; cityId: string; resources: Resources }; score: number }
  | { type: "SCOUT_TARGET"; reason: string; payload: { cityId: string; targetType: "CITY" | "BARBARIAN_CAMP"; targetId: string }; score: number }
  | { type: BotSocialActionType; reason: string; payload: Record<string, any>; score: number }
  | { type: "IDLE"; reason: string; payload: Record<string, never>; score: number };

export type BotSnapshot = {
  city: any;
  buildings: any[];
  units: any[];
  cityTechs: any[];
  activeBuildQueues: any[];
  activeTrainingQueues: any[];
  activeResearch: any | null;
  activeResearchQueues?: any[];
  allianceMembership?: any | null;
  alliances?: any[];
  marketOffers?: any[];
  allianceObjectives?: any[];
  activeOutgoingBattles: any[];
  targets: any[];
  barbarianCamps: any[];
  seasonState: any | null;
  state: any;
};

const ECONOMY_BUILDINGS: BuildingType[] = ["GOLD_MINE", "LUMBER_MILL", "QUARRY", "FARM", "STORAGE", "TOWN_HALL"];
const MILITARY_BUILDINGS: BuildingType[] = ["BARRACKS", "STABLE", "TOWER", "TOWN_HALL"];
const TECH_BUILDINGS: BuildingType[] = ["LIBRARY", "TOWN_HALL", "STORAGE"];
const BALANCED_BUILDINGS: BuildingType[] = ["TOWN_HALL", "GOLD_MINE", "LUMBER_MILL", "FARM", "BARRACKS", "LIBRARY", "STORAGE", "TOWER"];

function resourcesOf(city: any) {
  return {
    gold: city.gold ?? 0,
    wood: city.wood ?? 0,
    stone: city.stone ?? 0,
    food: city.food ?? 0,
    gems: city.gems ?? 0,
  };
}

function capsOf(city: any) {
  return {
    gold: city.maxGold ?? 1,
    wood: city.maxWood ?? 1,
    stone: city.maxStone ?? 1,
    food: city.maxFood ?? 1,
  };
}

const EDGE_CASE_PROBE_CHANCE = Number(process.env.BOT_PROBE_CHANCE ?? 0.04);

// Edge-case probe: bot intentionally tries something mildly invalid to test validation.
// Only fires ~4% of non-aggressive decisions. Returns null (no probe) most of the time.
function maybeProbeEdgeCase(decision: BotDecision, snapshot: BotSnapshot, profile: BotProfile): BotDecision | null {
  if (profile !== "CHAOTIC" && Math.random() > EDGE_CASE_PROBE_CHANCE) return null;
  if (profile === "CHAOTIC" && Math.random() > 0.12) return null;

  // Skip probes on attacks (too visible to players)
  if (decision.type === "ATTACK_CITY" || decision.type === "ATTACK_BARBARIAN") return null;
  if (decision.type === "IDLE") return null;

  const probes: BotDecision[] = [];

  if (decision.type === "UPGRADE_BUILDING") {
    // Try upgrading to beyond max level
    probes.push({
      type: "UPGRADE_BUILDING",
      reason: "CHAOTIC probe: upgrade beyond max level",
      payload: { buildingId: decision.payload.buildingId, buildingType: decision.payload.buildingType },
      score: 0,
    });
    // Try upgrading with insufficient resources
    probes.push({
      type: "UPGRADE_BUILDING",
      reason: "CHAOTIC probe: upgrade with 0 gold",
      payload: { buildingId: decision.payload.buildingId, buildingType: decision.payload.buildingType },
      score: 0,
    });
  }

  if (decision.type === "TRAIN_UNITS") {
    // Try training 0 units
    probes.push({
      type: "TRAIN_UNITS",
      reason: "CHAOTIC probe: train 0 units",
      payload: { unitType: decision.payload.unitType, count: 0 },
      score: 0,
    });
    // Try training with negative count (should be rejected by validation)
    probes.push({
      type: "TRAIN_UNITS",
      reason: "CHAOTIC probe: train -1 units",
      payload: { unitType: decision.payload.unitType, count: -1 },
      score: 0,
    });
  }

  if (decision.type === "SEND_RESOURCES") {
    // Try sending 0 resources
    probes.push({
      type: "SEND_RESOURCES",
      reason: "CHAOTIC probe: send 0 resources",
      payload: { recipientCityId: decision.payload.recipientCityId, resources: { gold: 0, wood: 0, stone: 0, food: 0, gems: 0 } },
      score: 0,
    });
  }

  if (decision.type === "CREATE_MARKET_OFFER") {
    // Try creating offer with 0 amount
    probes.push({
      type: "CREATE_MARKET_OFFER",
      reason: "CHAOTIC probe: offer with 0 amount",
      payload: { ...decision.payload, giveAmount: 0, wantAmount: 0 },
      score: 0,
    });
  }

  // For CHAOTIC bots, also probe alliance with bad data
  if (profile === "CHAOTIC" && decision.type === "JOIN_ALLIANCE") {
    probes.push({
      type: "JOIN_ALLIANCE",
      reason: "CHAOTIC probe: join nonexistent alliance",
      payload: { allianceId: "00000000-0000-0000-0000-000000000000" },
      score: 0,
    });
  }

  if (probes.length === 0) return null;
  const picked = probes[Math.floor(Math.random() * probes.length)];
  return { ...picked, _probe: true } as unknown as BotDecision;
}

function criticalResources(snapshot: BotSnapshot, config: BotSimulationConfig) {
  const resources = resourcesOf(snapshot.city);
  const caps = capsOf(snapshot.city);
  return (["gold", "wood", "stone", "food"] as const).filter((key) => resources[key] <= caps[key] * config.criticalResourceRatio);
}

function availableTroops(snapshot: BotSnapshot): Array<{ type: string; count: number }> {
  const committed = new Map<string, number>();
  for (const battle of snapshot.activeOutgoingBattles) {
    for (const unit of battle.units ?? []) {
      committed.set(unit.type, (committed.get(unit.type) ?? 0) + unit.count);
    }
  }
  return snapshot.units.map((u: any) => ({
    type: u.type,
    count: Math.max(0, u.count - (committed.get(u.type) ?? 0)),
  }));
}

function totalAvailableTroops(snapshot: BotSnapshot): number {
  return availableTroops(snapshot).reduce((s, u) => s + u.count, 0);
}

function hasIncomingAttacks(snapshot: BotSnapshot): boolean {
  return (snapshot.state?.incomingAttacks ?? []).length > 0;
}

function canSpendWithoutBreakingReserve(resources: Resources, caps: ReturnType<typeof capsOf>, cost: Resources, config: BotSimulationConfig, protectedKeys: Array<keyof Resources>) {
  if (!canAfford(resources, cost)) return false;
  return protectedKeys.every((key) => {
    if (key === "gems") return true;
    return (resources[key] - (cost[key] ?? 0)) >= caps[key] * config.resourceReserveRatio;
  });
}

function preferredBuildings(profile: BotProfile): BuildingType[] {
  if (profile === "ECONOMIST") return ECONOMY_BUILDINGS;
  if (profile === "MILITARIST") return MILITARY_BUILDINGS;
  if (profile === "TECH_RUSHER") return TECH_BUILDINGS;
  return BALANCED_BUILDINGS;
}

function chooseUpgrade(snapshot: BotSnapshot, profile: BotProfile, config: BotSimulationConfig): BotDecision | null {
  const queueConfig = getCityQueueConfig();
  if (snapshot.activeBuildQueues.length >= queueConfig.maxSlots.construction) {
    return { type: "IDLE", reason: "build queue full", payload: {}, score: 0 };
  }

  const resources = resourcesOf(snapshot.city);
  const caps = capsOf(snapshot.city);
  const critical = criticalResources(snapshot, config);
  const townHall = snapshot.buildings.find((b) => b.type === "TOWN_HALL");
  const townHallLevel = townHall?.level ?? 1;
  const weights = config.profileWeights[profile];
  const season = snapshot.seasonState?.currentSeason;
  const postRaid = snapshot.state?.postRaidRecovery;

  const seed = hashString(snapshot.city.id ?? "0");
  const buildings = shuffleWithSeed([...preferredBuildings(profile)], seed);

  if (postRaid) {
    buildings.unshift("STORAGE", "TOWER", "FARM", "LUMBER_MILL", "QUARRY");
  }
  if (hasIncomingAttacks(snapshot)) {
    buildings.unshift("TOWER", "BARRACKS", "STABLE");
  }
  if (season === "WINTER") buildings.unshift("FARM", "STORAGE");
  if (season === "SUMMER") buildings.unshift("GOLD_MINE", "BARRACKS");
  if (season === "AUTUMN") buildings.unshift("FARM", "STORAGE");
  if (season === "SPRING") buildings.unshift("TOWN_HALL", "LUMBER_MILL");
  if (critical.includes("wood")) buildings.unshift("LUMBER_MILL", "STORAGE");
  if (critical.includes("food")) buildings.unshift("FARM", "STORAGE");
  if (critical.includes("gold")) buildings.unshift("GOLD_MINE", "STORAGE");
  if (critical.includes("stone")) buildings.unshift("QUARRY", "STORAGE");

  const totalUpgrades = snapshot.buildings.reduce((s: number, b: any) => s + (b.level ?? 1) - 1, 0);
  if (totalUpgrades > 0 && totalUpgrades % 6 === 0 && !buildings.includes("TOWER")) {
    buildings.push("TOWER");
  }

  for (const type of buildings) {
    const building = snapshot.buildings.find((b) => b.type === type);
    if (!building) continue;
    const maxLevel = getBuildingMaxLevelForTownHall(townHallLevel, type);
    if ((building.level ?? 1) >= maxLevel) continue;
    const nextLevel = (building.level ?? 1) + 1;
    const cost = getBuildingCost(type, nextLevel);
    if (!canSpendWithoutBreakingReserve(resources, caps, cost, config, critical as Array<keyof Resources>)) continue;
    const seasonLabel = (season === "WINTER" && (type === "FARM" || type === "STORAGE")) ? "WINTER priority" :
      (season === "SUMMER" && type === "GOLD_MINE") ? "SUMMER boost" :
      (postRaid) ? "post-raid rebuild" : "";
    return {
      type: "UPGRADE_BUILDING",
      reason: seasonLabel || `${profile} upgrade ${type}`,
      payload: { buildingId: building.id, buildingType: type },
      score: weights.economy + (type === "TOWN_HALL" ? 2 : 0) + (season === "WINTER" && type === "FARM" ? 3 : 0),
    };
  }

  const existingTypes = new Set(snapshot.buildings.map((b: any) => b.type));
  const missing = preferredBuildings(profile).filter((t) => !existingTypes.has(t));
  if (missing.length > 0) {
    const type = missing[0];
    const cost = getBuildingCost(type, 1);
    if (canSpendWithoutBreakingReserve(resources, caps, cost, config, critical as Array<keyof Resources>)) {
      return {
        type: "UPGRADE_BUILDING",
        reason: `${profile} rebuild missing ${type}`,
        payload: { buildingId: "", buildingType: type },
        score: 3.0,
      };
    }
  }

  return null;
}

function chooseResearch(snapshot: BotSnapshot, profile: BotProfile, config: BotSimulationConfig): BotDecision | null {
  const queueConfig = getCityQueueConfig();
  const activeResearchQueues = snapshot.activeResearchQueues ?? (snapshot.activeResearch ? [snapshot.activeResearch] : []);
  if (activeResearchQueues.length >= queueConfig.maxSlots.research) {
    return { type: "IDLE", reason: "research queue full", payload: {}, score: 0 };
  }

  const cityTechs = snapshot.cityTechs.map((tech) => ({ techId: tech.techId, level: tech.level }));
  const resources = resourcesOf(snapshot.city);
  const caps = capsOf(snapshot.city);
  const critical = criticalResources(snapshot, config);
  const weights = config.profileWeights[profile];
  const configs = getAllTechConfigs()
    .map((cfg) => {
      const currentLevel = cityTechs.find((tech) => tech.techId === cfg.techId)?.level ?? 0;
      return { cfg, targetLevel: currentLevel + 1 };
    })
    .filter(({ cfg, targetLevel }) => targetLevel <= cfg.maxLevel)
    .sort((a, b) => {
      const aScore = techPrefScore(a.cfg.category, profile);
      const bScore = techPrefScore(b.cfg.category, profile);
      if (bScore !== aScore) return bScore - aScore;
      if (profile === "TECH_RUSHER" && UNLOCK_TECHS.includes(a.cfg.techId)) return -1;
      if (profile === "TECH_RUSHER" && UNLOCK_TECHS.includes(b.cfg.techId)) return 1;
      return 0;
    });

  for (const { cfg, targetLevel } of configs) {
    const check = canResearch(cfg.techId, targetLevel, cityTechs, null);
    if (!check.allowed) continue;
    const cost = getResearchCost(cfg.techId, targetLevel);
    if (!canSpendWithoutBreakingReserve(resources, caps, cost, config, critical as Array<keyof Resources>)) continue;
    return {
      type: "START_RESEARCH",
      reason: `${profile} research priority ${cfg.techId}`,
      payload: { techId: cfg.techId },
      score: weights.research,
    };
  }

  return null;
}

function chooseTraining(snapshot: BotSnapshot, profile: BotProfile, config: BotSimulationConfig): BotDecision | null {
  const queueConfig = getCityQueueConfig();
  if (snapshot.activeTrainingQueues.length >= queueConfig.maxSlots.training) {
    return { type: "IDLE", reason: "training queue full", payload: {}, score: 0 };
  }

  const resources = resourcesOf(snapshot.city);
  const caps = capsOf(snapshot.city);
  const critical = criticalResources(snapshot, config);
  const unlocked = getUnlockedUnits(snapshot.cityTechs);
  const preferred: UnitType[] = profile === "MILITARIST"
    ? ["CAVALRY", "SIEGE", "CATAPULT", "CROSSBOWMAN", "ARCHER", "PIKEMAN", "WARRIOR", "SPY"]
    : ["WARRIOR", "PIKEMAN", "ARCHER", "CROSSBOWMAN", "CAVALRY", "SPY", "SIEGE", "CATAPULT"];

  const season = snapshot.seasonState?.currentSeason;
  if (season === "WINTER") {
    const idx = preferred.indexOf("SPY");
    if (idx > -1) preferred.splice(idx, 1);
  }
  if (season === "SUMMER") {
    preferred.unshift("CAVALRY", "WARRIOR");
  }

  const unitCounts = new Map<string, number>();
  for (const u of snapshot.units) unitCounts.set(u.type, u.count);
  const sorted = preferred
    .filter((t) => unlocked.includes(t))
    .sort((a, b) => (unitCounts.get(a) ?? 0) - (unitCounts.get(b) ?? 0));
  const unitType = sorted[0] ?? "WARRIOR";

  for (const count of [10, 5, 2, 1]) {
    const cost = getUnitCost(unitType, count);
    if (canSpendWithoutBreakingReserve(resources, caps, cost, config, critical as Array<keyof Resources>)) {
      return {
        type: "TRAIN_UNITS",
        reason: `${profile} train ${unitType} (balance)`,
        payload: { unitType, count },
        score: config.profileWeights[profile].military,
      };
    }
  }

  return null;
}

function chooseSocial(snapshot: BotSnapshot, profile: BotProfile, config: BotSimulationConfig): BotDecision | null {
  if (Math.random() > config.socialActionChance) return null;
  const allianceCenter = snapshot.buildings.find((b) => b.type === "ALLIANCE_CENTER");
  const canUseAlliance = (allianceCenter?.level ?? 0) >= config.allianceCenterRequiredLevel;
  const membership = snapshot.allianceMembership;

  if (!membership && canUseAlliance) {
    const activeAlliances = (snapshot.alliances ?? []).filter((alliance) => !alliance.disbandedAt);
    const joinTarget = activeAlliances
      .filter((alliance) => Number(alliance.honorScore ?? 100) >= 60)
      .sort((a, b) => Number(b.honorScore ?? 100) - Number(a.honorScore ?? 100))[0];

    if (joinTarget) {
      return {
        type: "JOIN_ALLIANCE",
        reason: `${profile} joins reputable alliance`,
        payload: { allianceId: joinTarget.id },
        score: 2.2,
      };
    }

    if (!joinTarget && (profile === "ECONOMIST" || profile === "BALANCED")) {
      return {
        type: "CREATE_ALLIANCE",
        reason: `${profile} founds alliance`,
        payload: {},
        score: 2.0,
      };
    }
  }

  if (Math.random() <= config.chatActionChance) {
    const channel = membership?.allianceId ? "ALLIANCE" : "GLOBAL";
    return {
      type: "SEND_CHAT",
      reason: `${profile} social presence`,
      payload: { channel },
      score: 0.6,
    };
  }

  const target = snapshot.targets[0];
  if (target && profile === "BALANCED" && Math.random() <= config.chatActionChance) {
    return {
      type: "SEND_MAIL",
      reason: `${profile} diplomatic mail`,
      payload: { recipientCityId: target.id },
      score: 0.5,
    };
  }

  return null;
}

function chooseTrade(snapshot: BotSnapshot, profile: BotProfile, config: BotSimulationConfig): BotDecision | null {
  const market = snapshot.buildings.find((b) => b.type === "MARKET");
  if (!market || market.level < config.tradeMinMarketLevel) return null;

  const resources = resourcesOf(snapshot.city);
  const caps = { gold: snapshot.city.maxGold, wood: snapshot.city.maxWood, stone: snapshot.city.maxStone, food: snapshot.city.maxFood };
  
  const excess: Partial<Resources> = {};
  let totalExcess = 0;
  if (resources.gold > caps.gold * 0.85) { excess.gold = Math.floor(resources.gold * 0.2); totalExcess += excess.gold; }
  if (resources.wood > caps.wood * 0.85) { excess.wood = Math.floor(resources.wood * 0.2); totalExcess += excess.wood; }
  if (resources.stone > caps.stone * 0.85) { excess.stone = Math.floor(resources.stone * 0.2); totalExcess += excess.stone; }
  if (resources.food > caps.food * 0.85) { excess.food = Math.floor(resources.food * 0.2); totalExcess += excess.food; }

  if (totalExcess < 100) return null;

  const allianceId = snapshot.allianceMembership?.allianceId;
  const allies = allianceId
    ? snapshot.targets.filter((t: any) => t.allianceId === allianceId)
    : [];
  const target = allies.length > 0
    ? allies[Math.floor(Math.random() * allies.length)]
    : null;
  if (!target) return null;

  return {
    type: "SEND_RESOURCES",
    reason: `${profile} excess resources trade`,
    payload: { recipientCityId: target.id, resources: { gold: excess.gold ?? 0, wood: excess.wood ?? 0, stone: excess.stone ?? 0, food: excess.food ?? 0, gems: 0 } },
    score: 1.0,
  };
}

function chooseMarketOffer(snapshot: BotSnapshot, profile: BotProfile, config: BotSimulationConfig): BotDecision | null {
  if ((profile !== "ECONOMIST" && profile !== "BALANCED") || Math.random() > config.marketActionChance) return null;
  const market = snapshot.buildings.find((b) => b.type === "MARKET");
  if (!market) return null;
  const resources = resourcesOf(snapshot.city);
  const caps = capsOf(snapshot.city);
  const resourceKeys = ["gold", "wood", "stone", "food"] as const;
  const scarce = resourceKeys.find((key) => resources[key] < caps[key] * 0.35);
  const excess = resourceKeys.find((key) => resources[key] > caps[key] * 0.75 && key !== scarce);

  const acceptable = (snapshot.marketOffers ?? []).find((offer) => {
    const wantAmount = Number(offer.wantAmount ?? 0);
    const fee = Math.ceil(wantAmount * (Number(offer.feeRate ?? 0) || MARKET_FEE_RATE));
    return offer.creatorCityId !== snapshot.city.id &&
      offer.status === "OPEN" &&
      resources[offer.wantResource as keyof Resources] >= wantAmount + fee &&
      (!scarce || offer.giveResource === scarce);
  });
  if (acceptable) {
    return {
      type: "ACCEPT_MARKET_OFFER",
      reason: `${profile} accepts useful market offer`,
      payload: { offerId: acceptable.id, cityId: snapshot.city.id },
      score: config.profileWeights[profile].economy + 1.5,
    };
  }

  if (!scarce || !excess) return null;
  const amount = Math.max(50, Math.floor(resources[excess] * 0.15));
  return {
    type: "CREATE_MARKET_OFFER",
    reason: `${profile} creates market offer`,
    payload: { cityId: snapshot.city.id, giveResource: excess, giveAmount: amount, wantResource: scarce, wantAmount: amount },
    score: config.profileWeights[profile].economy + 1,
  };
}

function chooseAllianceContribution(snapshot: BotSnapshot, profile: BotProfile, config: BotSimulationConfig): BotDecision | null {
  if (!snapshot.allianceMembership?.allianceId || Math.random() > config.allianceContributionChance) return null;
  const objective = (snapshot.allianceObjectives ?? []).find((item) => item.status === "ACTIVE");
  if (!objective) return null;
  const resources = resourcesOf(snapshot.city);
  const contribution: Resources = {
    gold: Math.min(50, Math.max(0, resources.gold - 100)),
    wood: Math.min(50, Math.max(0, resources.wood - 100)),
    stone: Math.min(50, Math.max(0, resources.stone - 100)),
    food: Math.min(50, Math.max(0, resources.food - 100)),
    gems: 0,
  };
  if (contribution.gold + contribution.wood + contribution.stone + contribution.food <= 0) return null;
  return {
    type: "CONTRIBUTE_ALLIANCE_OBJECTIVE",
    reason: `${profile} contributes to alliance objective`,
    payload: { objectiveId: objective.id, cityId: snapshot.city.id, resources: contribution },
    score: profile === "ECONOMIST" ? 3.5 : 1.4,
  };
}

function chooseScout(snapshot: BotSnapshot, profile: BotProfile, config: BotSimulationConfig): BotDecision | null {
  if (Math.random() > config.scoutActionChance) return null;
  const spies = snapshot.units.find((unit) => unit.type === "SPY")?.count ?? 0;
  if (spies <= 0) return null;
  const scouted = snapshot.state?.scoutedTargets ?? {};
  const cityTarget = snapshot.targets.find((target) => !scouted[target.id]);
  const campTarget = snapshot.barbarianCamps.find((camp) => !scouted[camp.id]);
  const preferCity = profile === "MILITARIST" || profile === "TECH_RUSHER";
  const target = preferCity ? cityTarget ?? campTarget : campTarget ?? cityTarget;
  if (!target) return null;
  return {
    type: "SCOUT_TARGET",
    reason: `${profile} gathers intel`,
    payload: { cityId: snapshot.city.id, targetType: target === cityTarget ? "CITY" : "BARBARIAN_CAMP", targetId: target.id },
    score: profile === "TECH_RUSHER" ? 4 : 1.6,
  };
}

function chooseBarbarianHunt(snapshot: BotSnapshot, profile: BotProfile, config: BotSimulationConfig, now: Date): BotDecision | null {
  if (snapshot.barbarianCamps.length === 0 || snapshot.activeOutgoingBattles.length >= config.maxActiveOutgoingBattles) return null;

  const totalTroops = totalAvailableTroops(snapshot);
  if (totalTroops < config.minAttackTroops) return null;

  if (hasIncomingAttacks(snapshot)) return null;

  const avgBuildingLevel = snapshot.buildings.reduce((s: number, b: any) => s + (b.level ?? 1), 0) / Math.max(1, snapshot.buildings.length);
  const targetLevel = Math.max(1, Math.floor(avgBuildingLevel / 3));
  const sorted = [...snapshot.barbarianCamps].sort((a: any, b: any) =>
    Math.abs((a.level ?? 1) - targetLevel) - Math.abs((b.level ?? 1) - targetLevel)
  );
  const camp = sorted[0];
  const available = availableTroops(snapshot);
  // Use 60% of troops for barbarian hunts — enough to send a real force while keeping defense.
  // 0.4 was too low: with starter units (15 total), floor(15×0.4)=6 < minAttackTroops(8) → permanent IDLE.
  const units = available
    .map((u) => ({ type: u.type as UnitType, count: Math.floor(u.count * 0.6) }))
    .filter((u) => u.count > 0);

  if (units.reduce((s, u) => s + u.count, 0) < config.minAttackTroops) return null;

  return {
    type: "ATTACK_BARBARIAN",
    reason: `${profile} barbarian hunt L${camp.level}`,
    payload: { targetCampId: camp.id, units },
    score: config.profileWeights[profile].aggression * 0.8,
  };
}

function chooseAttack(snapshot: BotSnapshot, profile: BotProfile, config: BotSimulationConfig, now: Date): BotDecision | null {
  const weights = config.profileWeights[profile];
  if (weights.aggression <= 0 || snapshot.activeOutgoingBattles.length >= config.maxActiveOutgoingBattles) return null;

  const cooldownMinutes = config.attackCooldownRangeMinutes[0] + Math.random() * (config.attackCooldownRangeMinutes[1] - config.attackCooldownRangeMinutes[0]);
  const lastAttackAt = snapshot.state?.lastAttackAt ? new Date(snapshot.state.lastAttackAt).getTime() : 0;
  if (now.getTime() - lastAttackAt < cooldownMinutes * 60_000) return null;

  const totalTroops = totalAvailableTroops(snapshot);
  if (totalTroops < config.minAttackTroops) return null;

  if (hasIncomingAttacks(snapshot)) return null;

  const mem = memorySummary(snapshot.state);
  const lastLossResult = mem.lastLossAt ? new Date(mem.lastLossAt).getTime() : 0;
  const effectiveConsecutiveLosses = (mem.consecutiveLosses >= 2 && now.getTime() - lastLossResult > 30 * 60_000)
    ? 0
    : mem.consecutiveLosses;
  if (effectiveConsecutiveLosses >= 2) return null;

  const targetCooldowns = snapshot.state?.targetCooldowns ?? {};
  const incomingAttacks = snapshot.state?.incomingAttacks ?? [];
  
  const recentAttackerCityIds = new Set(incomingAttacks.map((a: any) => a.attackerCityId));
  let target = snapshot.targets.find(t => recentAttackerCityIds.has(t.id));
  let isRevenge = !!target;

  // Anti-bullying: hard cap — if we've hit a target 5+ times, permanently avoid them
  const hardAvoidTargets = new Set<string>();
  for (const [targetId, count] of mem.favoredTargetCounts) {
    if (count >= 5) hardAvoidTargets.add(targetId);
  }

  if (!target) {
    target = snapshot.targets.find((candidate) => {
      if (!mem.favoredTargets.has(candidate.id)) return false;
      if (hardAvoidTargets.has(candidate.id)) return false;
      const successCount = [...mem.favoredTargetCounts.entries()]
        .filter(([id]) => id === candidate.id)
        .reduce((s, [, c]) => s + c, 0);
      // Anti-bullying: if we've hit this target 3+ times successfully, double cooldown
      const effectiveCooldown = successCount >= 3
        ? config.targetCooldownMinutes * 2
        : config.targetCooldownMinutes;
      const lastTargetAt = targetCooldowns[candidate.id] ? new Date(targetCooldowns[candidate.id]).getTime() : 0;
      return now.getTime() - lastTargetAt >= effectiveCooldown * 60_000;
    });
  }

  if (!target) {
    target = snapshot.targets.find((candidate) => {
      const lastTargetAt = targetCooldowns[candidate.id] ? new Date(targetCooldowns[candidate.id]).getTime() : 0;
      return now.getTime() - lastTargetAt >= config.targetCooldownMinutes * 60_000;
    });
  }

  if (!target) return null;

  const spies = snapshot.units.find(u => u.type === "SPY")?.count ?? 0;
  const scouted = snapshot.state?.scoutedTargets ?? {};
  if (spies > 0 && scouted[target.id]) {
    const scoutAge = now.getTime() - new Date(scouted[target.id]).getTime();
    if (scoutAge < 30 * 60_000 && target.estimatedPower > snapshot.city.power * 1.5) {
      return null;
    }
  }

  const available = availableTroops(snapshot);
  const pct = profile === "MILITARIST" ? 0.4 : 0.3;
  const units = available
    .map((u) => ({ type: u.type as UnitType, count: Math.floor(u.count * pct) }))
    .filter((u) => u.count > 0);

  if (units.reduce((sum, unit) => sum + unit.count, 0) < config.minAttackTroops) return null;

  return {
    type: "ATTACK_CITY",
    reason: isRevenge ? `${profile} REVENGE attack` : `${profile} strategic attack`,
    payload: { targetCityId: target.id, units },
    score: weights.aggression * (isRevenge ? 2 : 1),
  };
}

export function decideBotAction(snapshot: BotSnapshot, profile: BotProfile, config: BotSimulationConfig, now: Date = new Date()): BotDecision {
  const candidates = [
    chooseAttack(snapshot, profile, config, now),
    chooseBarbarianHunt(snapshot, profile, config, now),
    chooseResearch(snapshot, profile, config),
    chooseScout(snapshot, profile, config),
    chooseMarketOffer(snapshot, profile, config),
    chooseAllianceContribution(snapshot, profile, config),
    chooseUpgrade(snapshot, profile, config),
    chooseTraining(snapshot, profile, config),
    chooseSocial(snapshot, profile, config),
    chooseTrade(snapshot, profile, config),
  ].filter(Boolean) as BotDecision[];

  const actionable = candidates.filter((candidate) => candidate.type !== "IDLE");
  let decision: BotDecision;
  if (actionable.length > 0) {
    decision = actionable.sort((a, b) => b.score - a.score)[0];
  } else {
    const critical = criticalResources(snapshot, config);
    if (critical.length > 0) {
      decision = { type: "IDLE", reason: `recover economy: waiting for ${critical.join(",")}`, payload: {}, score: 0 };
    } else {
      decision = candidates[0] ?? { type: "IDLE", reason: "waiting for next strategic opportunity", payload: {}, score: 0 };
    }
  }

  // Edge-case probing (only for non-attack decisions, safe in production)
  const probe = maybeProbeEdgeCase(decision, snapshot, profile);
  if (probe) {
    return probe;
  }

  return decision;
}

export function botActionType(decision: BotDecision): BotActionType {
  if (["CREATE_ALLIANCE", "JOIN_ALLIANCE", "SEND_CHAT", "SEND_MAIL"].includes(decision.type)) return "IDLE";
  return decision.type as BotActionType;
}

export function updateBotMemory(state: any, decision: BotDecision, result: "success" | "blocked" | "error", now: Date): any {
  const actionLog: Array<{ type: string; payload: any; result: string; timestamp: string }> = state?.actionLog ?? [];
  actionLog.push({
    type: decision.type,
    payload: decision.payload,
    result,
    timestamp: now.toISOString(),
  });
  const next = {
    ...(state ?? {}),
    actionLog: actionLog.slice(-20),
  };
  if (decision.type === "ATTACK_CITY" && result !== "success") {
    next.lastLossAt = now.toISOString();
  }
  return next;
}

export function memorySummary(state: any): { consecutiveLosses: number; lastLossAt: string | null; favoredTargets: Set<string>; favoredTargetCounts: Map<string, number>; recentActions: string[] } {
  const log: Array<{ type: string; payload: any; result: string }> = state?.actionLog ?? [];
  const recentActions = log.slice(-10).map((a) => a.type);
  let consecutiveLosses = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].result !== "success") consecutiveLosses++;
    else break;
  }
  const favoredTargets = new Set<string>();
  const favoredTargetCounts = new Map<string, number>();
  for (const entry of log) {
    if (entry.type === "ATTACK_CITY" && entry.result === "success" && entry.payload?.targetCityId) {
      favoredTargets.add(entry.payload.targetCityId);
      favoredTargetCounts.set(entry.payload.targetCityId, (favoredTargetCounts.get(entry.payload.targetCityId) ?? 0) + 1);
    }
  }
  return { consecutiveLosses, lastLossAt: state?.lastLossAt ?? null, favoredTargets, favoredTargetCounts, recentActions };
}
