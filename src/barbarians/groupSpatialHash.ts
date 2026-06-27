import type { BarbarianGroup } from "../sim/worldState.js";
import { getGroupCentroid } from "./barbarianPathfinding.js";

/** Macro-cell bucket size for group proximity queries. */
export const SPATIAL_CELL = 16;

export interface GroupSpatialEntry {
  id: string;
  x: number;
  y: number;
  group: BarbarianGroup;
}

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

function cellOf(x: number, y: number): [number, number] {
  return [Math.floor(x / SPATIAL_CELL), Math.floor(y / SPATIAL_CELL)];
}

export class GroupSpatialHash {
  private buckets = new Map<string, GroupSpatialEntry[]>();

  clear(): void {
    this.buckets.clear();
  }

  insert(entry: GroupSpatialEntry): void {
    const [cx, cy] = cellOf(entry.x, entry.y);
    const key = cellKey(cx, cy);
    let arr = this.buckets.get(key);
    if (!arr) {
      arr = [];
      this.buckets.set(key, arr);
    }
    arr.push(entry);
  }

  /** Visit entries whose bucket overlaps a square of `radius` macro cells around (x, y). */
  forEachInRadius(x: number, y: number, radius: number, fn: (entry: GroupSpatialEntry) => void): void {
    const [bcx, bcy] = cellOf(x, y);
    const r = Math.ceil(radius / SPATIAL_CELL);
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const arr = this.buckets.get(cellKey(bcx + dx, bcy + dy));
        if (!arr) continue;
        for (const entry of arr) fn(entry);
      }
    }
  }
}

export function buildGroupSpatialHash(groups: Iterable<BarbarianGroup>): GroupSpatialHash {
  const hash = new GroupSpatialHash();
  for (const group of groups) {
    if (!group.units.some(u => u.hp > 0)) continue;
    const c = getGroupCentroid(group.units);
    hash.insert({ id: group.id, x: c.x, y: c.y, group });
  }
  return hash;
}
