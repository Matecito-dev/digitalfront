import { NextResponse } from "next/server";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_WORLD_TERRAIN_MASK, normalizeWorldTerrainMask, type WorldTerrainMaskData } from "@/lib/worldTerrainMask";
import { requireAdmin, requireAdminGet } from "@/lib/adminAuth";

export const runtime = "nodejs";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const maskPath = path.join(process.cwd(), "src", "data", "world-terrain-mask.json");
const backupPath = path.join(process.cwd(), "src", "data", "world-terrain-mask.backup.json");

async function readMask(): Promise<WorldTerrainMaskData> {
  try {
    const raw = await readFile(maskPath, "utf8");
    return normalizeWorldTerrainMask(JSON.parse(raw) as WorldTerrainMaskData);
  } catch {
    return DEFAULT_WORLD_TERRAIN_MASK;
  }
}

export async function GET(req: Request) {
  const denied = requireAdminGet(req);
  if (denied) return denied;
  const mask = await readMask();
  return NextResponse.json(mask, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const body = await req.json() as WorldTerrainMaskData;
  const mask = normalizeWorldTerrainMask(body);

  // Backup before overwrite
  await copyFile(maskPath, backupPath).catch(() => {});
  await writeFile(maskPath, `${JSON.stringify(mask, null, 2)}\n`, "utf8");

  const repair = await fetch(`${API_BASE}/world/admin/repair-terrain`, { method: "POST" })
    .then(async (res) => res.ok ? await res.json() : { ok: false })
    .catch(() => ({ ok: false }));

  return NextResponse.json({ ok: true, repair }, { headers: { "Cache-Control": "no-store" } });
}
