// City founding in memory — validates placement, no DB.

import type { WorldState, City, BotProfile } from "../sim/worldState.js";
import { nextId } from "../sim/worldState.js";

const MIN_CITY_DISTANCE = 60;  // minimum cells between cities (well-spread across 512×384)

function isBuildable(state: WorldState, x: number, y: number): boolean {
  const { cols, rows, heights, cells } = state.terrain;
  if (x < 5 || y < 5 || x >= cols - 5 || y >= rows - 5) return false;
  const h = heights[y * cols + x];
  if (h < 20) return false;
  const kind = cells[y * cols + x];
  return kind !== "MOUNTAIN" && kind !== "WATER";
}

// Simple seedable LCG so city positions are reproducible per-world
function lcg(n: number): () => number {
  let s = (n ^ 0xdeadbeef) >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}

export function foundCity(
  state: WorldState,
  profile: BotProfile,
  name: string,
  x?: number,
  y?: number,
): City | null {
  const { cols, rows } = state.terrain;

  let cx = x, cy = y;
  if (cx == null || cy == null) {
    // Grid-based placement: divide map into zones, pick random cell within zone.
    // Falls back to random scan if zone is all water/mountain.
    const rng = lcg(state.cities.size * 7919 + (state.terrain.heights[0] ?? 0));
    for (let attempt = 0; attempt < 300; attempt++) {
      const tx = 5 + Math.floor(rng() * (cols - 10));
      const ty = 5 + Math.floor(rng() * (rows - 10));
      if (!isBuildable(state, tx, ty)) continue;
      const tooClose = [...state.cities.values()].some(c => Math.hypot(c.x - tx, c.y - ty) < MIN_CITY_DISTANCE);
      if (tooClose) continue;
      cx = tx; cy = ty;
      break;
    }
  }

  if (cx == null || cy == null || !isBuildable(state, cx, cy)) return null;

  const id = nextId(state);
  const city: City = {
    id,
    name,
    botProfile: profile,
    x: cx,
    y: cy,
    level: 1,
    gold: 500, wood: 300, stone: 200, food: 400,
    maxGold: 2000, maxWood: 2000, maxStone: 2000, maxFood: 2000,
    buildings: [{ id: nextId(state), type: "TOWN_HALL", level: 1 }],
    units: [],
    techs: [],
    lastBotDecisionMs: 0,
    outgoingBattles: [],
  };

  state.cities.set(id, city);
  return city;
}

const BOT_NAMES = ["Ironhold", "Ashenvale", "Stonemark", "Goldgate", "Thornwall",
  "Embercrest", "Frostpeak", "Silverbrook", "Duskwood", "Redfort",
  "Westmere", "Eastgate", "Highpass", "Lowmarch", "Greyhaven"];

export function ensureBotPopulation(state: WorldState, targetCount = 8): City[] {
  const profiles: BotProfile[] = ["ECONOMIST", "MILITARIST", "TECH_RUSHER", "BALANCED", "CHAOTIC"];
  const founded: City[] = [];
  let nameIdx = state.cities.size;

  while (state.cities.size < targetCount) {
    const profile = profiles[state.cities.size % profiles.length];
    const name = BOT_NAMES[nameIdx % BOT_NAMES.length] + (nameIdx >= BOT_NAMES.length ? ` ${Math.floor(nameIdx / BOT_NAMES.length)}` : "");
    nameIdx++;
    const city = foundCity(state, profile, name);
    if (city) founded.push(city);
    else break;  // couldn't find valid position, stop trying
  }
  return founded;
}
