import type { Resources } from "../shared/economy.js";

export interface ProductionRates {
  goldPerHour: number;
  woodPerHour: number;
  stonePerHour: number;
  foodPerHour: number;
}

export interface StorageCaps {
  maxGold: number;
  maxWood: number;
  maxStone: number;
  maxFood: number;
}

/**
 * Calculate current resources based on elapsed time.
 * Resources accrue over time up to storage cap.
 */
export function calculateResources(
  current: Resources,
  rates: ProductionRates,
  caps: StorageCaps,
  lastUpdate: Date,
  now: Date = new Date()
): Resources {
  const hoursElapsed = Math.max(0, (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60));

  return {
    gold: Math.min(caps.maxGold, Math.floor(current.gold + rates.goldPerHour * hoursElapsed)),
    wood: Math.min(caps.maxWood, Math.floor(current.wood + rates.woodPerHour * hoursElapsed)),
    stone: Math.min(caps.maxStone, Math.floor(current.stone + rates.stonePerHour * hoursElapsed)),
    food: Math.min(caps.maxFood, Math.floor(current.food + rates.foodPerHour * hoursElapsed)),
    gems: current.gems, // Gems don't generate passively
  };
}

export function canAfford(current: Resources, cost: Resources): boolean {
  return (
    current.gold >= cost.gold &&
    current.wood >= cost.wood &&
    current.stone >= cost.stone &&
    current.food >= cost.food &&
    current.gems >= cost.gems
  );
}

export function subtractResources(current: Resources, cost: Resources): Resources {
  return {
    gold: current.gold - cost.gold,
    wood: current.wood - cost.wood,
    stone: current.stone - cost.stone,
    food: current.food - cost.food,
    gems: current.gems - cost.gems,
  };
}

export function addResources(current: Resources, amount: Resources): Resources {
  return {
    gold: current.gold + amount.gold,
    wood: current.wood + amount.wood,
    stone: current.stone + amount.stone,
    food: current.food + amount.food,
    gems: current.gems + amount.gems,
  };
}

export function clampResources(resources: Resources, caps: StorageCaps): Resources {
  return {
    gold: Math.max(0, Math.min(caps.maxGold, resources.gold)),
    wood: Math.max(0, Math.min(caps.maxWood, resources.wood)),
    stone: Math.max(0, Math.min(caps.maxStone, resources.stone)),
    food: Math.max(0, Math.min(caps.maxFood, resources.food)),
    gems: Math.max(0, resources.gems),
  };
}
