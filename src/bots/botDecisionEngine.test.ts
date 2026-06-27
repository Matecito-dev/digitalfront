import { beforeAll, describe, expect, it } from "vitest";
import type { BotSimulationConfig } from "./botConfigData.js";
import { botActionType, decideBotAction, type BotDecision, type BotSnapshot } from "./botDecisionEngine.js";
import { loadBuildingConfigs } from "../economy/buildings.js";
import { loadTechConfigs } from "../economy/techs.js";
import { loadUnitConfigs } from "../economy/units.js";

const config: BotSimulationConfig = {
  enabled: true,
  provider: "postgres",
  targetCount: 1,
  tickSeconds: 45,
  maxBotsPerTick: 1,
  minAttackTroops: 8,
  maxActiveOutgoingBattles: 2,
  attackCooldownMinutes: 30,
  targetCooldownMinutes: 45,
  maxAttackDistance: 80,
  newPlayerProtectionHours: 24,
  globalTargetCooldownMinutes: 120,
  tradeMinMarketLevel: 1,
  resourceReserveRatio: 0.18,
  criticalResourceRatio: 0.08,
  socialActionChance: 0,
  chatActionChance: 0,
  marketActionChance: 0,
  scoutActionChance: 0,
  allianceContributionChance: 0,
  chatRateLimitWindowMs: 120_000,
  allianceCenterRequiredLevel: 5,
  attackCooldownRangeMinutes: [20, 60],
  errorRecoveryMinutes: 15,
  metricsWindowMinutes: 15,
  sleepSimulationEnabled: false,
  sleepWindowStartHour: 1,
  sleepWindowEndHour: 5,
  profiles: ["ECONOMIST", "MILITARIST", "TECH_RUSHER", "BALANCED", "CHAOTIC"],
  profileWeights: {
    ECONOMIST: { economy: 5, military: 1, research: 1, aggression: 0 },
    MILITARIST: { economy: 1, military: 5, research: 1, aggression: 3 },
    TECH_RUSHER: { economy: 1, military: 1, research: 5, aggression: 0 },
    BALANCED: { economy: 3, military: 3, research: 3, aggression: 1 },
    CHAOTIC: { economy: 2, military: 4, research: 1, aggression: 3.5 },
  },
};

function snapshot(overrides: Partial<BotSnapshot> = {}): BotSnapshot {
  return {
    city: {
      id: "city-1",
      gold: 1000,
      wood: 1000,
      stone: 1000,
      food: 1000,
      gems: 0,
      maxGold: 2000,
      maxWood: 2000,
      maxStone: 2000,
      maxFood: 2000,
    },
    buildings: [
      { id: "town-hall", type: "TOWN_HALL", level: 3 },
      { id: "lumber", type: "LUMBER_MILL", level: 1 },
      { id: "farm", type: "FARM", level: 1 },
      { id: "barracks", type: "BARRACKS", level: 1 },
    ],
    units: [],
    cityTechs: [],
    activeBuildQueues: [],
    activeTrainingQueues: [],
    activeResearch: null,
    activeResearchQueues: [],
    allianceMembership: null,
    alliances: [],
    activeOutgoingBattles: [],
    targets: [],
    barbarianCamps: [],
    seasonState: null,
    state: {},
    ...overrides,
  };
}

beforeAll(async () => {
  await loadBuildingConfigs();
  await loadUnitConfigs();
  await loadTechConfigs();
});

describe("bot decision engine", () => {
  it("prioritizes recovery idling when critical resources block affordable actions", () => {
    const decision = decideBotAction(
      snapshot({ city: { ...snapshot().city, gold: 10, wood: 10, stone: 10, food: 10 } }),
      "ECONOMIST",
      config,
      new Date("2026-05-08T00:00:00.000Z")
    );

    expect(decision.type).toBe("IDLE");
    expect(decision.reason).toContain("recover economy");
  });

  it("keeps filling construction queue slots until the configured maximum is reached", () => {
    const decision = decideBotAction(
      snapshot({ activeBuildQueues: [{ id: "q1", completesAt: "2026-05-08T00:10:00.000Z" }] }),
      "ECONOMIST",
      { ...config, profileWeights: { ...config.profileWeights, ECONOMIST: { economy: 10, military: 0, research: 0, aggression: 0 } } },
      new Date("2026-05-08T00:00:00.000Z")
    );

    expect(decision.type).toBe("UPGRADE_BUILDING");
  });

  it("selects barbarian hunts when a militarist has enough troops and a nearby camp", () => {
    const decision = decideBotAction(
      snapshot({
        units: [{ type: "WARRIOR", count: 30 }],
        barbarianCamps: [{ id: "camp-1", level: 1 }],
      }),
      "MILITARIST",
      { ...config, profileWeights: { ...config.profileWeights, MILITARIST: { economy: 0, military: 1, research: 0, aggression: 10 } } },
      new Date("2026-05-08T00:00:00.000Z")
    );

    expect(decision.type).toBe("ATTACK_BARBARIAN");
  });

  it("maps social decisions to IDLE action logs for current persistence compatibility", () => {
    const decision: BotDecision = { type: "CREATE_ALLIANCE", reason: "test", payload: {}, score: 1 };

    expect(botActionType(decision)).toBe("IDLE");
  });
});
