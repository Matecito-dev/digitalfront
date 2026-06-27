import type { BarbarianGroup, BarbarianUnit, PlayerSquad } from "./worldState.js";
import type { SimEvent } from "./events.js";
import type { RNG } from "./rng.js";
import { randInt } from "./rng.js";

export const HEAL_INSTANT_COST_PER_UNIT = 15;
export const RECRUIT_SOLDIER_COST = 25;
export const RECRUIT_SNIPER_COST = 35;
export const RECOMPOSE_COST_PER_UNIT = 20;
export const RESUPPLY_COST = 10;

export const PVP_LOOT_MIN = 20;
export const PVP_LOOT_MAX = 500;
export const PVP_LOOT_PCT_MIN = 0.4;
export const PVP_LOOT_PCT_MAX = 0.7;

const BARB_SOLDIER_GOLD: [number, number] = [8, 15];
const BARB_SNIPER_GOLD: [number, number] = [12, 20];
const GROUP_BONUS: [number, number] = [25, 80];
export const BOSS_GOLD_MULTIPLIER = 2;

export function rollBarbKillGold(rng: RNG, unitType: BarbarianUnit["type"]): number {
  const range = unitType === "sniper" ? BARB_SNIPER_GOLD : BARB_SOLDIER_GOLD;
  return randInt(rng, range[1] - range[0] + 1) + range[0];
}

export function rollGroupDefeatBonus(rng: RNG, groupSize: number): number {
  const base = randInt(rng, GROUP_BONUS[1] - GROUP_BONUS[0] + 1) + GROUP_BONUS[0];
  return Math.min(GROUP_BONUS[1], base + Math.floor(groupSize * 2));
}

export function computePvpLoot(loserGold: number, rng: RNG): number {
  const pct = PVP_LOOT_PCT_MIN + rng() * (PVP_LOOT_PCT_MAX - PVP_LOOT_PCT_MIN);
  const raw = Math.floor(loserGold * pct);
  return Math.max(PVP_LOOT_MIN, Math.min(PVP_LOOT_MAX, raw));
}

export function addGold(
  squad: PlayerSquad,
  amount: number,
  reason: string,
  events: SimEvent[],
): number {
  if (amount <= 0) return 0;
  squad.gold = (squad.gold ?? 0) + amount;
  events.push({
    type: "GOLD_GAINED",
    profileId: squad.profileId,
    amount,
    reason,
    totalGold: squad.gold,
  });
  return amount;
}

export function spendGold(
  squad: PlayerSquad,
  amount: number,
  reason: string,
  events: SimEvent[],
): boolean {
  const current = squad.gold ?? 0;
  if (amount > current) return false;
  squad.gold = current - amount;
  events.push({
    type: "GOLD_LOST",
    profileId: squad.profileId,
    amount,
    reason,
    totalGold: squad.gold,
  });
  return true;
}

export function awardBarbKillGold(
  squad: PlayerSquad,
  unitType: BarbarianUnit["type"],
  rng: RNG,
  events: SimEvent[],
): void {
  addGold(squad, rollBarbKillGold(rng, unitType), "barb_kill", events);
}

export function awardGroupDefeatGold(
  squad: PlayerSquad,
  group: BarbarianGroup,
  rng: RNG,
  events: SimEvent[],
): void {
  const size = group.units.length;
  let bonus = rollGroupDefeatBonus(rng, size);
  if (group.isBoss) bonus = Math.floor(bonus * BOSS_GOLD_MULTIPLIER);
  addGold(squad, bonus, group.isBoss ? "boss_defeated" : "group_defeated", events);
}

export function transferPvpGold(
  winner: PlayerSquad,
  loser: PlayerSquad,
  rng: RNG,
  events: SimEvent[],
): number {
  const loot = computePvpLoot(loser.gold ?? 0, rng);
  if (loot <= 0) return 0;
  const taken = Math.min(loot, loser.gold ?? 0);
  if (taken <= 0) return 0;
  loser.gold = (loser.gold ?? 0) - taken;
  events.push({
    type: "GOLD_LOST",
    profileId: loser.profileId,
    amount: taken,
    reason: "pvp_loot",
    totalGold: loser.gold,
  });
  addGold(winner, taken, "pvp_loot", events);
  return taken;
}
