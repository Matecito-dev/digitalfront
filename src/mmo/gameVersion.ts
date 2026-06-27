import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface GameVersionInfo {
  version: string;
  title: string;
  changelog: string[];
}

let cached: GameVersionInfo | null = null;

function resolveVersionJsonPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../../version.json", "../../../version.json"]) {
    const p = join(here, rel);
    if (existsSync(p)) return p;
  }
  return join(process.cwd(), "version.json");
}

function loadVersionFile(): GameVersionInfo {
  if (cached) return cached;
  const raw = readFileSync(resolveVersionJsonPath(), "utf8");
  const parsed = JSON.parse(raw) as GameVersionInfo;
  cached = {
    version: String(parsed.version ?? "0.0.0"),
    title: String(parsed.title ?? ""),
    changelog: Array.isArray(parsed.changelog) ? parsed.changelog.map(String) : [],
  };
  return cached;
}

export function getGameVersion(): GameVersionInfo {
  return loadVersionFile();
}

export function getGameVersionString(): string {
  return getGameVersion().version;
}
