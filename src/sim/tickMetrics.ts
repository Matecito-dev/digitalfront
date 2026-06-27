export interface TickPhaseMs {
  season: number;
  bots: number;
  spawn: number;
  barbarianGroups: number;
  combat: number;
  attacks: number;
  player: number;
  total: number;
}

const ENABLED = process.env.SIM_METRICS === "1";

let sum: TickPhaseMs = zeroPhases();
let tickCount = 0;
let lastLogWallMs = Date.now();

function zeroPhases(): TickPhaseMs {
  return { season: 0, bots: 0, spawn: 0, barbarianGroups: 0, combat: 0, attacks: 0, player: 0, total: 0 };
}

export function isSimMetricsEnabled(): boolean {
  return ENABLED;
}

export function recordTickPhases(phases: TickPhaseMs): void {
  if (!ENABLED) return;
  sum.season += phases.season;
  sum.bots += phases.bots;
  sum.spawn += phases.spawn;
  sum.barbarianGroups += phases.barbarianGroups;
  sum.combat += phases.combat;
  sum.attacks += phases.attacks;
  sum.player += phases.player;
  sum.total += phases.total;
  tickCount++;

  const now = Date.now();
  if (now - lastLogWallMs < 5000) return;

  if (tickCount > 0) {
    const n = tickCount;
    const avg = (k: keyof TickPhaseMs) => (sum[k] / n).toFixed(2);
    console.log(
      `[sim-metrics] ticks=${n} avg_ms/tick total=${avg("total")} ` +
      `season=${avg("season")} bots=${avg("bots")} spawn=${avg("spawn")} ` +
      `groups=${avg("barbarianGroups")} combat=${avg("combat")} player=${avg("player")} attacks=${avg("attacks")}`,
    );
  }
  sum = zeroPhases();
  tickCount = 0;
  lastLogWallMs = now;
}
