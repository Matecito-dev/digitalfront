/**
 * Synthetic WebSocket load test — N guest clients, scenarios, metrics.
 *
 * Usage:
 *   npm run loadtest:ws
 *   npm run loadtest:ws -- --clients=30 --duration=60 --scenario=cluster
 *   npm run loadtest:ws -- --scenario=pvp --json
 *   LOADTEST_CLIENTS=50 tsx scripts/loadtest-ws.ts
 *
 * Requires viewer-server running (npm run dev).
 */
import WebSocket from "ws";
import { BRAND } from "../src/shared/branding.js";
import { MACRO_COLS, MACRO_ROWS } from "../src/worldgen/tiling.js";

type Scenario = "scatter" | "cluster" | "pvp" | "combat";

function parseArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.find(a => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const HOST = process.env.LOADTEST_HOST ?? "localhost";
const PORT = Number(process.env.LOADTEST_PORT ?? "3333");
const CLIENTS = Number(parseArg("clients", process.env.LOADTEST_CLIENTS ?? "20"));
const DURATION_SEC = Number(parseArg("duration", process.env.LOADTEST_DURATION ?? "30"));
const SEED = process.env.LOADTEST_SEED ?? BRAND.defaultWorldSeed;
const SCENARIO = parseArg("scenario", process.env.LOADTEST_SCENARIO ?? "scatter") as Scenario;
const JSON_OUT = process.argv.includes("--json");

const BASE = `http://${HOST}:${PORT}`;
const WS_URL = `ws://${HOST}:${PORT}/api/sim/ws`;

const POS_INTERVAL_MS = 250;
const ORDER_INTERVAL_MS = 5_000;
const PVP_INTERVAL_MS = 10_000;
const CLUSTER_RADIUS = 40;
const CLUSTER_CENTER = { x: MACRO_COLS * 0.5, y: MACRO_ROWS * 0.5 };

interface ClientStats {
  id: number;
  connected: boolean;
  authenticated: boolean;
  profileId: string | null;
  snapshots: number;
  deltas: number;
  errors: number;
  orderErrs: number;
  authErrs: number;
  campErrs: number;
  bytesIn: number;
  firstDeltaMs: number | null;
  authOkAt: number | null;
}

interface LoadtestReport {
  seed: string;
  scenario: Scenario;
  clients: number;
  durationSec: number;
  connected: number;
  authenticated: number;
  authRate: number;
  snapshots: number;
  deltas: number;
  errors: number;
  orderErrs: number;
  authErrs: number;
  campErrs: number;
  bytesInKb: number;
  kbPerClientPerSec: number;
  firstDeltaMs: { min: number | null; max: number | null; avg: number | null; p95: number | null };
}

async function guestAuth(username: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`guest auth failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("guest auth: missing token");
  return data.token;
}

async function ensureWorldRunning(): Promise<void> {
  const url = `${BASE}/api/world?seed=${encodeURIComponent(SEED)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`world init failed (${res.status}) — is viewer-server running?`);
  }
}

function randomCoord(max: number): number {
  return Math.random() * (max - 1);
}

function clusterCoord(center: number, radius: number): number {
  return center + (Math.random() * 2 - 1) * radius;
}

function pickPosition(id: number): { x: number; y: number } {
  if (SCENARIO === "cluster") {
    return {
      x: clusterCoord(CLUSTER_CENTER.x, CLUSTER_RADIUS),
      y: clusterCoord(CLUSTER_CENTER.y, CLUSTER_RADIUS),
    };
  }
  return { x: randomCoord(MACRO_COLS), y: randomCoord(MACRO_ROWS) };
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? null;
}

function runClient(
  id: number,
  stats: ClientStats,
  peerProfileIds: () => string[],
  visibleBarbIds: Set<string>,
): Promise<void> {
  return new Promise(resolve => {
    const username = `lt${String(id).padStart(3, "0")}${Date.now().toString(36).slice(-4)}`;
    let ws: WebSocket | null = null;
    let posTimer: ReturnType<typeof setInterval> | null = null;
    let orderTimer: ReturnType<typeof setInterval> | null = null;
    let pvpTimer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      if (posTimer) clearInterval(posTimer);
      if (orderTimer) clearInterval(orderTimer);
      if (pvpTimer) clearInterval(pvpTimer);
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      resolve();
    };

    void (async () => {
      try {
        const token = await guestAuth(username);
        ws = new WebSocket(WS_URL);

        ws.on("open", () => {
          stats.connected = true;
          ws!.send(JSON.stringify({ type: "auth", token }));
        });

        ws.on("message", (data) => {
          const raw = data.toString();
          stats.bytesIn += Buffer.byteLength(raw, "utf8");
          try {
            const msg = JSON.parse(raw) as {
              type?: string;
              reason?: string;
              profileId?: string;
              playerSquad?: { profileId?: string };
              barbarianGroups?: { id: string }[];
            };
            if (msg.barbarianGroups) {
              for (const g of msg.barbarianGroups) visibleBarbIds.add(g.id);
            }
            if (msg.type === "auth_ok") {
              stats.authenticated = true;
              stats.authOkAt = Date.now();
              stats.profileId = msg.profileId ?? msg.playerSquad?.profileId ?? null;

              const pos = pickPosition(id);
              posTimer = setInterval(() => {
                if (!ws || ws.readyState !== WebSocket.OPEN) return;
                const p = SCENARIO === "cluster" ? pos : pickPosition(id);
                ws.send(JSON.stringify({ type: "pos", x: p.x, y: p.y }));
              }, POS_INTERVAL_MS + Math.random() * 100);

              orderTimer = setInterval(() => {
                if (!ws || ws.readyState !== WebSocket.OPEN) return;
                const p = pickPosition(id);
                if (SCENARIO === "combat") {
                  const barbs = [...visibleBarbIds];
                  if (barbs.length > 0) {
                    const groupId = barbs[id % barbs.length]!;
                    ws.send(JSON.stringify({
                      type: "order",
                      order: "attack",
                      groupId,
                      x: p.x,
                      y: p.y,
                    }));
                    return;
                  }
                }
                const order = Math.random() < 0.85 ? "move" : "hold";
                ws.send(JSON.stringify({
                  type: "order",
                  order,
                  x: p.x,
                  y: p.y,
                }));
              }, ORDER_INTERVAL_MS + Math.random() * 500);

              if (SCENARIO === "pvp") {
                pvpTimer = setInterval(() => {
                  if (!ws || ws.readyState !== WebSocket.OPEN) return;
                  const peers = peerProfileIds().filter(pid => pid !== stats.profileId);
                  if (!peers.length) return;
                  const target = peers[id % peers.length]!;
                  const p = pickPosition(id);
                  ws.send(JSON.stringify({
                    type: "order",
                    order: "attack_pvp",
                    targetProfileId: target,
                    x: p.x,
                    y: p.y,
                  }));
                }, PVP_INTERVAL_MS + Math.random() * 1000);
              }
            } else if (msg.type === "auth_err") {
              stats.errors++;
              stats.authErrs++;
              console.warn(`[loadtest] client ${id} auth_err: ${msg.reason ?? "unknown"}`);
              cleanup();
            } else if (msg.type === "order_err") {
              stats.errors++;
              stats.orderErrs++;
            } else if (msg.type === "camp_err") {
              stats.errors++;
              stats.campErrs++;
            } else if (msg.type === "snapshot") {
              stats.snapshots++;
            } else if (msg.type === "delta") {
              stats.deltas++;
              if (stats.firstDeltaMs == null && stats.authOkAt != null) {
                stats.firstDeltaMs = Date.now() - stats.authOkAt;
              }
            }
          } catch {
            stats.errors++;
          }
        });

        ws.on("error", (err) => {
          stats.errors++;
          console.warn(`[loadtest] client ${id} ws error:`, err.message);
        });

        ws.on("close", cleanup);
      } catch (err) {
        stats.errors++;
        console.warn(`[loadtest] client ${id} setup failed:`, err);
        cleanup();
      }
    })();
  });
}

function buildReport(allStats: ClientStats[]): LoadtestReport {
  const connected = allStats.filter(s => s.connected).length;
  const authenticated = allStats.filter(s => s.authenticated).length;
  const totalSnapshots = allStats.reduce((a, s) => a + s.snapshots, 0);
  const totalDeltas = allStats.reduce((a, s) => a + s.deltas, 0);
  const totalBytesIn = allStats.reduce((a, s) => a + s.bytesIn, 0);
  const totalErrors = allStats.reduce((a, s) => a + s.errors, 0);
  const orderErrs = allStats.reduce((a, s) => a + s.orderErrs, 0);
  const authErrs = allStats.reduce((a, s) => a + s.authErrs, 0);
  const campErrs = allStats.reduce((a, s) => a + s.campErrs, 0);
  const deltaTimes = allStats
    .map(s => s.firstDeltaMs)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  const avgDelta = deltaTimes.length
    ? deltaTimes.reduce((a, b) => a + b, 0) / deltaTimes.length
    : null;

  return {
    seed: SEED,
    scenario: SCENARIO,
    clients: CLIENTS,
    durationSec: DURATION_SEC,
    connected,
    authenticated,
    authRate: CLIENTS > 0 ? authenticated / CLIENTS : 0,
    snapshots: totalSnapshots,
    deltas: totalDeltas,
    errors: totalErrors,
    orderErrs,
    authErrs,
    campErrs,
    bytesInKb: totalBytesIn / 1024,
    kbPerClientPerSec: authenticated > 0
      ? (totalBytesIn / authenticated) / 1024 / DURATION_SEC
      : 0,
    firstDeltaMs: {
      min: deltaTimes[0] ?? null,
      max: deltaTimes[deltaTimes.length - 1] ?? null,
      avg: avgDelta != null ? Math.round(avgDelta) : null,
      p95: percentile(deltaTimes, 95),
    },
  };
}

function printReport(report: LoadtestReport): void {
  console.log("\n[loadtest] results:");
  console.log(`  scenario:       ${report.scenario}`);
  console.log(`  connected:      ${report.connected}/${report.clients}`);
  console.log(`  authenticated:  ${report.authenticated}/${report.clients}`);
  console.log(`  snapshots:      ${report.snapshots}`);
  console.log(`  deltas:         ${report.deltas}`);
  console.log(`  errors:         ${report.errors} (order_err=${report.orderErrs} auth_err=${report.authErrs} camp_err=${report.campErrs})`);
  console.log(`  firstDeltaMs:   min=${report.firstDeltaMs.min} avg=${report.firstDeltaMs.avg} p95=${report.firstDeltaMs.p95} max=${report.firstDeltaMs.max}`);
  console.log(`  bytes in total: ${report.bytesInKb.toFixed(0)} KB`);
  console.log(`  ~KB/s/client:   ${report.kbPerClientPerSec.toFixed(1)} (inbound)`);
}

async function main(): Promise<void> {
  const validScenarios: Scenario[] = ["scatter", "cluster", "pvp", "combat"];
  if (!validScenarios.includes(SCENARIO)) {
    throw new Error(`unknown scenario "${SCENARIO}" — use scatter|cluster|pvp|combat`);
  }

  if (!JSON_OUT) {
    console.log(
      `[loadtest] seed=${SEED} scenario=${SCENARIO} clients=${CLIENTS} duration=${DURATION_SEC}s → ${WS_URL}`,
    );
  }

  await ensureWorldRunning();

  const allStats: ClientStats[] = Array.from({ length: CLIENTS }, (_, i) => ({
    id: i,
    connected: false,
    authenticated: false,
    profileId: null,
    snapshots: 0,
    deltas: 0,
    errors: 0,
    orderErrs: 0,
    authErrs: 0,
    campErrs: 0,
    bytesIn: 0,
    firstDeltaMs: null,
    authOkAt: null,
  }));

  const visibleBarbIds = new Set<string>();

  const peerProfileIds = () =>
    allStats.filter(s => s.authenticated && s.profileId).map(s => s.profileId!);
  const getVisibleBarbIds = () => [...visibleBarbIds];

  const staggerMs = Math.min(50, Math.max(10, Math.floor(2000 / CLIENTS)));
  const runners: Promise<void>[] = [];
  for (let i = 0; i < CLIENTS; i++) {
    await new Promise(r => setTimeout(r, staggerMs));
    runners.push(runClient(i, allStats[i]!, peerProfileIds, visibleBarbIds));
  }

  await new Promise(r => setTimeout(r, DURATION_SEC * 1000));

  const report = buildReport(allStats);

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  if (report.authenticated < CLIENTS * 0.9) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error("[loadtest] fatal:", err);
  process.exit(1);
});
