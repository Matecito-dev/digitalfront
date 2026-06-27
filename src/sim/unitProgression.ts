/** Unit level progression — max level 10; affects vision, range, HP, armor. */

import type { PlayerUnit } from "./worldState.js";
import type { SimEvent } from "./events.js";

export const MAX_UNIT_LEVEL = 10;
export const PLAYER_SPAWN_COMBAT_GRACE_MS = 45_000;

const SOLDIER_BASE_HP = 120;
const SNIPER_BASE_HP = 70;

/** XP needed to advance from `level` to level+1. */
export function xpToNextLevel(level: number): number {
  if (level >= MAX_UNIT_LEVEL) return Infinity;
  return 40 + level * 25;
}

export function totalXpForLevel(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpToNextLevel(l);
  return sum;
}

export function maxHpForType(type: PlayerUnit["type"], level: number): number {
  const lv = clampLevel(level);
  const base = type === "sniper" ? SNIPER_BASE_HP : SOLDIER_BASE_HP;
  const perLevel = type === "sniper" ? 3 : 4;
  return base + (lv - 1) * perLevel;
}

/** Additive vision bonus on top of terrain base (macro cells). */
export function visionBonus(level: number): number {
  const lv = clampLevel(level);
  return (lv - 1) * 0.35;
}

/** Additive rifle/sniper range bonus (macro cells). */
export function rangeBonus(type: PlayerUnit["type"], level: number): number {
  const lv = clampLevel(level);
  const per = type === "sniper" ? 0.3 : 0.25;
  return (lv - 1) * per;
}

/** Damage reduction 0..~0.18 at level 10. */
export function armorDamageMult(level: number): number {
  const lv = clampLevel(level);
  return 1 - (lv - 1) * 0.02;
}

export function applyDamageWithArmor(rawDamage: number, targetLevel: number): number {
  const reduced = Math.round(rawDamage * armorDamageMult(targetLevel));
  return Math.max(1, reduced);
}

export function clampLevel(level: number): number {
  return Math.max(1, Math.min(MAX_UNIT_LEVEL, Math.floor(level) || 1));
}

export function ensureUnitProgression(u: PlayerUnit): void {
  u.level = clampLevel(u.level ?? 1);
  u.xp = Math.max(0, u.xp ?? 0);
  const max = maxHpForType(u.type, u.level);
  if (!u.maxHp || u.maxHp < max) {
    const oldMax = u.maxHp || max;
    u.maxHp = max;
    if (u.hp > 0) u.hp = Math.min(max, u.hp + (max - oldMax));
  }
}

export function initUnitProgression(u: PlayerUnit): void {
  u.level = 1;
  u.xp = 0;
  u.maxHp = maxHpForType(u.type, 1);
  u.hp = u.maxHp;
}

export interface GrantXpResult {
  leveledUp: boolean;
  newLevel: number;
  xpGained: number;
}

/** Grant XP; returns level-up info. Emits via returned events array. */
export function grantUnitXp(
  u: PlayerUnit,
  amount: number,
  events: SimEvent[],
  profileId?: string,
): GrantXpResult {
  ensureUnitProgression(u);
  const level = u.level!;
  const xp = u.xp!;
  if (u.hp <= 0 || level >= MAX_UNIT_LEVEL) {
    return { leveledUp: false, newLevel: level, xpGained: 0 };
  }

  const gained = Math.max(0, Math.floor(amount));
  if (gained <= 0) return { leveledUp: false, newLevel: level, xpGained: 0 };

  u.xp = xp + gained;
  let leveledUp = false;

  while (u.level! < MAX_UNIT_LEVEL && u.xp! >= xpToNextLevel(u.level!)) {
    u.xp! -= xpToNextLevel(u.level!);
    u.level!++;
    leveledUp = true;
    const oldMax = u.maxHp;
    u.maxHp = maxHpForType(u.type, u.level!);
    u.hp = Math.min(u.maxHp, u.hp + (u.maxHp - oldMax));
    events.push({
      type: "UNIT_LEVEL_UP",
      unitId: u.id,
      unitName: u.name,
      level: u.level!,
      profileId,
    });
  }

  if (u.level! >= MAX_UNIT_LEVEL) u.xp = 0;

  return { leveledUp, newLevel: u.level!, xpGained: gained };
}

export const XP_DAMAGE_DEALT = 1;
export const XP_BARB_SOLDIER_KILL = 18;
export const XP_BARB_SNIPER_KILL = 28;
export const XP_PVP_KILL = 35;

export function xpForBarbKill(type: "soldier" | "sniper"): number {
  return type === "sniper" ? XP_BARB_SNIPER_KILL : XP_BARB_SOLDIER_KILL;
}

export function isPlayerInSpawnGrace(squad: { sessionJoinedAtMs: number }, nowWallMs = Date.now()): boolean {
  return nowWallMs - squad.sessionJoinedAtMs < PLAYER_SPAWN_COMBAT_GRACE_MS;
}
