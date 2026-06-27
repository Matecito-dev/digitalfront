// The simulation tick engine.
// tick(state, dtSimMs, rng) → SimEvent[]
// All side effects are mutations of state in-place.

import type { WorldState } from "./worldState.js";
import type { SimEvent } from "./events.js";
import type { RNG } from "./rng.js";
import { advanceSeason } from "./seasonsMath.js";
import { tickSpawn, tickBarbarians, tickBarbarianAttacks } from "../barbarians/barbarianSim.js";
import { tickBarbarianGroups } from "../barbarians/barbarianGroupAI.js";
import { tickBarbarianPlayerAI } from "../barbarians/barbarianPlayerAI.js";
import { tickBarbarianGroupCombat } from "../barbarians/barbarianGroupCombat.js";
import { tickBarbarianVsPlayer } from "./barbarianVsPlayer.js";
import { tickBots } from "../bots/botSim.js";
import { ensureBotPopulation } from "../cities/cityFounding.js";
import { tickAllPlayerSquads } from "./playerSquad.js";
import { tickPlayerCombat } from "./playerCombat.js";
import { tickPlayerVsPlayer } from "./playerVsPlayer.js";
import { tickOutpostFreeHeal, checkAndMarkSquadWipes } from "./outpostActions.js";
import { isSimMetricsEnabled, recordTickPhases, type TickPhaseMs } from "./tickMetrics.js";

export function tick(state: WorldState, dtSimMs: number, rng: RNG): SimEvent[] {
  if (state.paused) return [];

  const metrics = isSimMetricsEnabled();
  const t0 = metrics ? performance.now() : 0;
  let phaseStart = t0;
  const phases: TickPhaseMs = { season: 0, bots: 0, spawn: 0, barbarianGroups: 0, combat: 0, attacks: 0, total: 0, player: 0 };

  const nowMs = state.simTimeMs + dtSimMs;
  state.simTimeMs = nowMs;

  const events: SimEvent[] = [];

  // Advance season
  const prevSeason = state.season.currentSeason;
  state.season = advanceSeason(state.season, nowMs);
  if (state.season.currentSeason !== prevSeason) {
    events.push({ type: "SEASON_CHANGED", season: state.season.currentSeason, phase: state.season.phase });
  }

  if (metrics) {
    phases.season = performance.now() - phaseStart;
    phaseStart = performance.now();
  }

  // Ensure bot city population
  const newCities = ensureBotPopulation(state, 8);
  for (const c of newCities) {
    events.push({ type: "CITY_FOUNDED", cityId: c.id, name: c.name, botProfile: c.botProfile, x: c.x, y: c.y });
  }

  // Bot decisions + production
  events.push(...tickBots(state, nowMs, dtSimMs, rng));

  if (metrics) {
    phases.bots = performance.now() - phaseStart;
    phaseStart = performance.now();
  }

  // Barbarian spawn
  events.push(...tickSpawn(state, nowMs, rng));

  if (metrics) {
    phases.spawn = performance.now() - phaseStart;
    phaseStart = performance.now();
  }

  // Barbarian player hunt AI (detect + march)
  events.push(...tickBarbarianPlayerAI(state, nowMs, rng));

  // Barbarian groups (AI + movement)
  events.push(...tickBarbarianGroups(state, nowMs, dtSimMs, rng));

  if (metrics) {
    phases.barbarianGroups = performance.now() - phaseStart;
    phaseStart = performance.now();
  }

  // Barbarian group combat
  events.push(...tickBarbarianGroupCombat(state, nowMs, dtSimMs, rng));

  if (metrics) {
    phases.combat = performance.now() - phaseStart;
    phaseStart = performance.now();
  }

  // Player squad movement + PvE combat
  tickAllPlayerSquads(state, dtSimMs);
  events.push(...tickPlayerCombat(state, nowMs, dtSimMs, rng));
  events.push(...tickPlayerVsPlayer(state, nowMs, dtSimMs, rng));
  events.push(...tickBarbarianVsPlayer(state, nowMs, dtSimMs, rng));
  checkAndMarkSquadWipes(state, events);
  tickOutpostFreeHeal(state, dtSimMs);

  if (metrics) {
    phases.player = performance.now() - phaseStart;
    phaseStart = performance.now();
  }

  // Barbarian camp logic (trades)
  events.push(...tickBarbarians(state, nowMs, rng));

  // Barbarian attacks on cities
  events.push(...tickBarbarianAttacks(state, nowMs, rng));

  if (metrics) {
    phases.attacks = performance.now() - phaseStart;
    phases.total = performance.now() - t0;
    recordTickPhases(phases);
  }

  return events;
}

// Compute real-time delay between ticks based on speed multiplier
export function tickIntervalMs(_speedMultiplier: number): number {
  return 50;
}

export function simDtMs(_speedMultiplier: number): number {
  // Real-time MMO: 50ms sim per 50ms wall clock
  return 50;
}

export { isSimMetricsEnabled } from "./tickMetrics.js";
