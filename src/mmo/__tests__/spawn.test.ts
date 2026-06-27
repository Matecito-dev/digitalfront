import { describe, it, expect, beforeEach } from "vitest";
import {
  findMultiplayerSpawn,
  MIN_SPAWN_DISTANCE,
  MIN_SPAWN_DISTANCE_HIGH_POP,
  getMinSpawnDistance,
  formationFitsAt,
  countAliveSquadsBySector,
  leastPopulatedSectors,
  MAP_SECTOR_COUNT,
} from "../spawn.js";
import { createPlayerSquad, getPlayerCentroid } from "../../sim/playerSquad.js";
import type { PlayerSquad, TerrainSnapshot } from "../../sim/worldState.js";
import { getTerrainNavGrid, resetPathfindingCache } from "../../barbarians/barbarianPathfinding.js";

function makeTerrain(cols = 80, rows = 60): TerrainSnapshot {
  const n = cols * rows;
  const heights = new Uint8Array(n);
  const cells = Array.from({ length: n }, () => "PLAINS" as const);
  for (let i = 0; i < n; i++) heights[i] = 40;
  return { cells, heights, hillshade: new Uint8Array(n), cols, rows, seed: 1 };
}

describe("spawn", () => {
  beforeEach(() => resetPathfindingCache());

  it("formationFitsAt on open plains", () => {
    const grid = getTerrainNavGrid(makeTerrain());
    expect(formationFitsAt(grid, 40.5, 30.5)).toBe(true);
  });

  it("spawns away from existing squads when map has room", () => {
    const terrain = makeTerrain(200, 200);
    const squads = new Map<string, PlayerSquad>();
    const existing = createPlayerSquad("p1", "Alpha", 10, 10);
    squads.set("p1", existing);

    const spawn = findMultiplayerSpawn(terrain, squads, "p2");
    const ec = getPlayerCentroid(existing.units);
    const dist = Math.hypot(spawn.x - ec.x, spawn.y - ec.y);
    expect(dist).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
  });

  it("allows respawn near self when excluded", () => {
    const terrain = makeTerrain();
    const squads = new Map<string, PlayerSquad>();
    const existing = createPlayerSquad("p1", "Alpha", 40, 30);
    squads.set("p1", existing);

    const spawn = findMultiplayerSpawn(terrain, squads, "p1");
    expect(formationFitsAt(getTerrainNavGrid(terrain), spawn.x, spawn.y)).toBe(true);
  });

  it("uses wider spawn distance when player count exceeds 10", () => {
    expect(getMinSpawnDistance(10)).toBe(MIN_SPAWN_DISTANCE);
    expect(getMinSpawnDistance(11)).toBe(MIN_SPAWN_DISTANCE_HIGH_POP);
    expect(getMinSpawnDistance(20)).toBe(MIN_SPAWN_DISTANCE_HIGH_POP);
    expect(getMinSpawnDistance(20)).toBe(32);
  });

  it("spawns 20 players on a large map with sector spread", () => {
    const terrain = makeTerrain(800, 600);
    const squads = new Map<string, PlayerSquad>();

    for (let i = 0; i < 20; i++) {
      const pid = `p${i}`;
      const spawn = findMultiplayerSpawn(terrain, squads, pid);
      expect(formationFitsAt(getTerrainNavGrid(terrain), spawn.x, spawn.y)).toBe(true);
      squads.set(pid, createPlayerSquad(pid, `Cap${i}`, spawn.x, spawn.y));
    }

    expect(squads.size).toBe(20);
    const sectorCounts = countAliveSquadsBySector([...squads.values()], terrain.cols, terrain.rows);
    expect(sectorCounts.filter(n => n > 0).length).toBeGreaterThanOrEqual(4);
  });

  it("distributes spawns across 8 map sectors", () => {
    expect(MAP_SECTOR_COUNT).toBe(8);
    const counts = countAliveSquadsBySector([], 512, 384);
    expect(counts).toHaveLength(8);
    expect(leastPopulatedSectors(counts)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
