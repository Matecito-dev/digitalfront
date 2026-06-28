/** Spawn/kill viewer-server en tests — mata el árbol completo (npx/tsx/node). */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PID_FILE = path.join(os.tmpdir(), "digitalfront-vitest-servers.json");

type RegistryEntry = { pid: number; port: number; startedAt: number };

function readRegistry(): RegistryEntry[] {
  try {
    return JSON.parse(fs.readFileSync(PID_FILE, "utf8")) as RegistryEntry[];
  } catch {
    return [];
  }
}

function writeRegistry(entries: RegistryEntry[]): void {
  if (entries.length === 0) {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* already gone */
    }
    return;
  }
  fs.writeFileSync(PID_FILE, JSON.stringify(entries));
}

function register(pid: number, port: number): void {
  writeRegistry([...readRegistry(), { pid, port, startedAt: Date.now() }]);
}

function unregister(pid: number): void {
  writeRegistry(readRegistry().filter(e => e.pid !== pid));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Mata proceso + hijos (requiere spawn con detached: true). */
export function killProcessTree(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

export async function stopTestViewerServer(proc: ChildProcess | null): Promise<void> {
  if (!proc?.pid) return;
  const { pid } = proc;
  killProcessTree(pid, "SIGTERM");
  await new Promise(r => setTimeout(r, 600));
  if (isAlive(pid)) killProcessTree(pid, "SIGKILL");
  unregister(pid);
}

/** Mata todos los servidores registrados por tests (y vitest huérfanos leves). */
export async function cleanupTestViewerServers(): Promise<number> {
  const entries = readRegistry();
  let killed = 0;

  for (const entry of entries) {
    if (isAlive(entry.pid)) {
      killProcessTree(entry.pid, "SIGTERM");
      killed++;
    }
  }

  await new Promise(r => setTimeout(r, 400));

  for (const entry of entries) {
    if (isAlive(entry.pid)) killProcessTree(entry.pid, "SIGKILL");
  }

  writeRegistry([]);

  // Vitest pool workers que quedaron si el padre murió antes (sin tocar npm run dev :3333)
  try {
    const { execSync } = await import("node:child_process");
    execSync('pkill -f "node \\(vitest" 2>/dev/null || true', { stdio: "ignore" });
  } catch {
    /* ignore */
  }

  return killed;
}

export function spawnTestViewerServer(root: string, port: number): ChildProcess {
  const tsx = path.join(root, "node_modules/.bin/tsx");
  const proc = spawn(tsx, ["scripts/viewer-server.ts"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DF_TEST_SERVER: "1",
      DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/none",
      REDIS_URL: "redis://127.0.0.1:1",
    },
  });
  proc.unref();
  if (proc.pid) register(proc.pid, port);
  return proc;
}
