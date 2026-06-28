import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { BRAND } from "../../src/shared/branding.js";
import { spawnTestViewerServer, stopTestViewerServer } from "./testViewerServer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SEED = BRAND.defaultWorldSeed;

async function waitForHttp(port: number, attempts = 120): Promise<void> {
  const url = `http://127.0.0.1:${port}/api/world?seed=${encodeURIComponent(SEED)}`;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`server not ready on port ${port}`);
}

async function guestToken(port: number, username: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) throw new Error(`guest auth failed: ${res.status}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

interface WsClient {
  profileId: string;
  snapshots: number;
  deltas: number;
  otherSquads: Map<string, unknown>;
  close: () => void;
}

function connectWsClient(port: number, username: string): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const otherSquads = new Map<string, unknown>();
    let profileId = "";
    let snapshots = 0;
    let deltas = 0;
    let settled = false;
    let ws: WebSocket;

    const finishIfReady = () => {
      if (settled || !profileId || snapshots < 1) return;
      settled = true;
      resolve({
        profileId,
        snapshots,
        deltas,
        otherSquads,
        close: () => { if (ws.readyState === WebSocket.OPEN) ws.close(); },
      });
    };

    void (async () => {
      try {
        const token = await guestToken(port, username);
        ws = new WebSocket(`ws://127.0.0.1:${port}/api/sim/ws`);

        ws.on("open", () => {
          ws.send(JSON.stringify({ type: "auth", token }));
        });

        ws.on("message", (raw) => {
          try {
            const msg = JSON.parse(raw.toString()) as {
              type?: string;
              profileId?: string;
              otherSquads?: { profileId: string }[];
            };
            if (msg.otherSquads) {
              for (const s of msg.otherSquads) otherSquads.set(s.profileId, s);
            }
            if (msg.type === "snapshot") {
              snapshots++;
              finishIfReady();
            }
            if (msg.type === "delta") deltas++;
            if (msg.type === "auth_ok" && msg.profileId) {
              profileId = msg.profileId;
              finishIfReady();
            }
          } catch { /* ignore */ }
        });

        ws.on("error", reject);
      } catch (err) {
        reject(err);
      }
    })();
  });
}

function waitMs(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

describe("ws multi-client AOI consistency", () => {
  let serverProc: ChildProcess | null = null;
  let port = 0;

  beforeAll(async () => {
    port = 36_000 + Math.floor(Math.random() * 4_000);
    serverProc = spawnTestViewerServer(root, port);
    await waitForHttp(port);
  }, 120_000);

  afterAll(async () => {
    await stopTestViewerServer(serverProc);
    serverProc = null;
  });

  it("connects 3 guest clients with snapshots", async () => {
    const tag = Date.now().toString(36);
    const clients = await Promise.all([
      connectWsClient(port, `wsmc1_${tag}`),
      connectWsClient(port, `wsmc2_${tag}`),
      connectWsClient(port, `wsmc3_${tag}`),
    ]);

    try {
      await waitMs(2_500);
      for (const c of clients) {
        expect(c.profileId).toBeTruthy();
        expect(c.snapshots).toBeGreaterThanOrEqual(1);
      }
      const ids = new Set(clients.map(c => c.profileId));
      expect(ids.size).toBe(3);
    } finally {
      for (const c of clients) c.close();
    }
  }, 20_000);
});
