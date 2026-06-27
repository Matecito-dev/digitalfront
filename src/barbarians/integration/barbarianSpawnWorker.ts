import { processBarbarianSpawns, processCampEscalation } from '../domain/barbarians.js';

let workerRunning = false;
let workerTickRunning = false;
let escalationTick = 0;
const SPAWN_INTERVAL_MS = 60_000;
const ESCALATION_CHECK_INTERVAL = 5; // Run escalation every 5 spawn ticks (5 minutes)

export function startBarbarianSpawnWorker(): void {
  if (workerRunning) return;
  workerRunning = true;

  console.log(`🏕️  Barbarian spawn worker started (tick every ${SPAWN_INTERVAL_MS / 1000}s)`);

  setInterval(async () => {
    if (workerTickRunning) return;
    workerTickRunning = true;
    try {
      await processBarbarianSpawnTick();
    } catch (err) {
      console.error('Barbarian spawn worker error:', err);
    } finally {
      workerTickRunning = false;
    }
  }, SPAWN_INTERVAL_MS);
}

export async function processBarbarianSpawnTick(): Promise<void> {
  await processBarbarianSpawns();

  escalationTick++;
  if (escalationTick >= ESCALATION_CHECK_INTERVAL) {
    await processCampEscalation();
    escalationTick = 0;
  }
}
