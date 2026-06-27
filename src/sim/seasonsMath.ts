// Pure season math — no DB access, no external deps.

export type Season = "SPRING" | "SUMMER" | "AUTUMN" | "WINTER";
export type SeasonPhase = "START" | "PEAK" | "TRANSITION";

export interface SeasonState {
  currentSeason: Season;
  nextSeason: Season;
  phase: SeasonPhase;
  intensity: number;  // 0–1
  startedAtMs: number;
  peakAtMs: number;
  transitionAtMs: number;
  endsAtMs: number;
}

const SEASON_ORDER: Season[] = ["SPRING", "SUMMER", "AUTUMN", "WINTER"];

export function getNextSeason(season: Season): Season {
  return SEASON_ORDER[(SEASON_ORDER.indexOf(season) + 1) % 4];
}

// Sim season durations (in sim-milliseconds). These are "game time" not real time.
const SEASON_DURATION_SIM_MS = 72 * 60 * 60 * 1000;   // 72 sim-hours per season
const TRANSITION_MS = 6 * 60 * 60 * 1000;
const START_MS = 4 * 60 * 60 * 1000;

export function initSeason(nowMs: number): SeasonState {
  const currentSeason: Season = "SPRING";
  return {
    currentSeason,
    nextSeason: getNextSeason(currentSeason),
    phase: "START",
    intensity: 0,
    startedAtMs: nowMs,
    peakAtMs: nowMs + START_MS,
    transitionAtMs: nowMs + SEASON_DURATION_SIM_MS - TRANSITION_MS,
    endsAtMs: nowMs + SEASON_DURATION_SIM_MS,
  };
}

export function advanceSeason(state: SeasonState, nowMs: number): SeasonState {
  if (nowMs < state.endsAtMs) {
    // Update phase and intensity
    let phase: SeasonPhase = "START";
    let intensity = 0;
    if (nowMs >= state.transitionAtMs) {
      phase = "TRANSITION";
      const t = (nowMs - state.transitionAtMs) / (state.endsAtMs - state.transitionAtMs);
      intensity = 1 - Math.min(1, t);
    } else if (nowMs >= state.peakAtMs) {
      phase = "PEAK";
      intensity = 1;
    } else {
      const t = (nowMs - state.startedAtMs) / (state.peakAtMs - state.startedAtMs);
      intensity = Math.min(1, t);
    }
    return { ...state, phase, intensity };
  }

  // Advance to next season
  const next = getNextSeason(state.currentSeason);
  return {
    currentSeason: next,
    nextSeason: getNextSeason(next),
    phase: "START",
    intensity: 0,
    startedAtMs: state.endsAtMs,
    peakAtMs: state.endsAtMs + START_MS,
    transitionAtMs: state.endsAtMs + SEASON_DURATION_SIM_MS - TRANSITION_MS,
    endsAtMs: state.endsAtMs + SEASON_DURATION_SIM_MS,
  };
}

export function calculateIntensity(state: SeasonState, nowMs: number): number {
  return advanceSeason(state, nowMs).intensity;
}
