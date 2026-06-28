import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { BRAND } from "../../src/shared/branding.js";
import { parseSeed } from "../static-server.js";
import { spawnTestViewerServer, stopTestViewerServer } from "./testViewerServer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SEED = BRAND.defaultWorldSeed;
const SEED_NUM = parseSeed(SEED);

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

describe("web flow smoke", () => {
  let serverProc: ChildProcess | null = null;
  let port = 0;

  beforeAll(async () => {
    port = 37_000 + Math.floor(Math.random() * 4_000);
    serverProc = spawnTestViewerServer(root, port);
    await waitForHttp(port);
  }, 120_000);

  afterAll(async () => {
    await stopTestViewerServer(serverProc);
    serverProc = null;
  });

  it("guest login → world → tile → WS snapshot", async () => {
    const tag = Date.now().toString(36);
    const base = `http://127.0.0.1:${port}`;

    const authRes = await fetch(`${base}/api/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: `smoke_${tag}` }),
    });
    expect(authRes.ok).toBe(true);
    const auth = (await authRes.json()) as { token: string; profile: { id: string } };
    expect(auth.token).toBeTruthy();
    expect(auth.profile?.id).toBeTruthy();

    const worldRes = await fetch(`${base}/api/world?seed=${encodeURIComponent(SEED)}`);
    expect(worldRes.ok).toBe(true);
    const world = (await worldRes.json()) as { seed: number; tilesX: number };
    expect(world.seed).toBe(SEED_NUM);
    expect(world.tilesX).toBeGreaterThan(0);

    const tileRes = await fetch(
      `${base}/api/tile.bin?seed=${encodeURIComponent(SEED)}&tx=0&ty=0`,
    );
    expect(tileRes.ok).toBe(true);
    const tileBuf = await tileRes.arrayBuffer();
    expect(tileBuf.byteLength).toBeGreaterThan(0);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/sim/ws`);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WS smoke timeout"));
      }, 15_000);
      let authOk = false;
      let gotSnapshot = false;

      const finish = () => {
        if (!authOk || !gotSnapshot) return;
        clearTimeout(timeout);
        ws.close();
        resolve();
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "auth", token: auth.token }));
      });

      ws.on("message", raw => {
        try {
          const msg = JSON.parse(raw.toString()) as { type?: string };
          if (msg.type === "auth_ok") {
            authOk = true;
            finish();
          }
          if (msg.type === "snapshot") {
            gotSnapshot = true;
            finish();
          }
        } catch { /* ignore */ }
      });

      ws.on("error", err => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }, 30_000);
});
