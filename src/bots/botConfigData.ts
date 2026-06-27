function readNumber(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

export type BotProfile = "ECONOMIST" | "MILITARIST" | "TECH_RUSHER" | "BALANCED" | "CHAOTIC";

export type BotProfileWeights = {
  economy: number;
  military: number;
  research: number;
  aggression: number;
};

const DEFAULT_PROFILES: BotProfile[] = ["ECONOMIST", "MILITARIST", "TECH_RUSHER", "BALANCED", "CHAOTIC"];
const DEFAULT_PROFILE_WEIGHTS: Record<BotProfile, BotProfileWeights> = {
  ECONOMIST: { economy: 5, military: 1, research: 3, aggression: 0.5 },
  MILITARIST: { economy: 2, military: 5, research: 2, aggression: 3 },
  TECH_RUSHER: { economy: 2, military: 1, research: 5, aggression: 0.75 },
  BALANCED: { economy: 3, military: 3, research: 3, aggression: 1.5 },
  CHAOTIC: { economy: 2, military: 4, research: 1, aggression: 3.5 },
};

export type BotSimulationConfig = {
  enabled: boolean;
  provider: string;
  targetCount: number;
  tickSeconds: number;
  maxBotsPerTick: number;
  minAttackTroops: number;
  maxActiveOutgoingBattles: number;
  attackCooldownMinutes: number;
  targetCooldownMinutes: number;
  maxAttackDistance: number;
  newPlayerProtectionHours: number;
  globalTargetCooldownMinutes: number;
  tradeMinMarketLevel: number;
  resourceReserveRatio: number;
  criticalResourceRatio: number;
  socialActionChance: number;
  chatActionChance: number;
  marketActionChance: number;
  scoutActionChance: number;
  allianceContributionChance: number;
  chatRateLimitWindowMs: number;
  allianceCenterRequiredLevel: number;
  attackCooldownRangeMinutes: [number, number];
  errorRecoveryMinutes: number;
  metricsWindowMinutes: number;
  sleepSimulationEnabled: boolean;
  sleepWindowStartHour: number;
  sleepWindowEndHour: number;
  profiles: BotProfile[];
  profileWeights: Record<BotProfile, BotProfileWeights>;
};

export function getBotSimulationConfig(): BotSimulationConfig {
  const explicitEnabled = process.env.BOTS_ENABLED === "true";
  const explicitDisabled = process.env.BOTS_ENABLED === "false";
  const devDefaultEnabled = process.env.NODE_ENV !== "production" && !explicitDisabled;
  const provider = process.env.DB_PROVIDER ?? "matecito";
  return {
    enabled: explicitDisabled ? false : provider === "postgres" ? (explicitEnabled || devDefaultEnabled) : explicitEnabled,
    provider,
    targetCount: readNumber("BOT_TARGET_COUNT", 6),
    tickSeconds: readNumber("BOT_TICK_SECONDS", 45),
    maxBotsPerTick: readNumber("BOT_MAX_PER_TICK", 3),
    minAttackTroops: readNumber("BOT_MIN_ATTACK_TROOPS", 8),
    maxActiveOutgoingBattles: readNumber("BOT_MAX_ACTIVE_ATTACKS", 2),
    attackCooldownMinutes: readNumber("BOT_ATTACK_COOLDOWN_MINUTES", 30),
    targetCooldownMinutes: readNumber("BOT_TARGET_COOLDOWN_MINUTES", 25),
    maxAttackDistance: readNumber("BOT_MAX_ATTACK_DISTANCE", 140),
    newPlayerProtectionHours: readNumber("BOT_NEW_PLAYER_PROTECTION_HOURS", 24),
    globalTargetCooldownMinutes: readNumber("BOT_GLOBAL_TARGET_COOLDOWN_MINUTES", 45),
    attackCooldownRangeMinutes: [
      readNumber("BOT_ATTACK_COOLDOWN_RANGE_MIN", 10),
      readNumber("BOT_ATTACK_COOLDOWN_RANGE_MAX", 30),
    ],
    tradeMinMarketLevel: readNumber("BOT_TRADE_MIN_MARKET_LEVEL", 1),
    resourceReserveRatio: readNumber("BOT_RESOURCE_RESERVE_RATIO", 0.18),
    criticalResourceRatio: readNumber("BOT_CRITICAL_RESOURCE_RATIO", 0.08),
    socialActionChance: readNumber("BOT_SOCIAL_ACTION_CHANCE", 0.18),
    chatActionChance: readNumber("BOT_CHAT_ACTION_CHANCE", 0.08),
    marketActionChance: readNumber("BOT_MARKET_ACTION_CHANCE", 0.18),
    scoutActionChance: readNumber("BOT_SCOUT_ACTION_CHANCE", 0.16),
    allianceContributionChance: readNumber("BOT_ALLIANCE_CONTRIBUTION_CHANCE", 0.16),
    chatRateLimitWindowMs: readNumber("BOT_CHAT_RATE_LIMIT_WINDOW_MS", 120_000),
    allianceCenterRequiredLevel: readNumber("BOT_ALLIANCE_CENTER_REQUIRED_LEVEL", 5),
    errorRecoveryMinutes: readNumber("BOT_ERROR_RECOVERY_MINUTES", 15),
    metricsWindowMinutes: readNumber("BOT_METRICS_WINDOW_MINUTES", 15),
    sleepSimulationEnabled: process.env.BOT_SLEEP_SIMULATION !== "false",
    sleepWindowStartHour: readNumber("BOT_SLEEP_WINDOW_START", 1),
    sleepWindowEndHour: readNumber("BOT_SLEEP_WINDOW_END", 5),
    profiles: DEFAULT_PROFILES,
    profileWeights: DEFAULT_PROFILE_WEIGHTS,
  };
}
