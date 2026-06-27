// Simulation event types emitted by tick()

export type SimEvent =
  | { type: "CAMP_SPAWNED"; campId: string; archetype: string; x: number; y: number; level: number }
  | { type: "CAMP_DEFEATED"; campId: string; name: string; byId: string }
  | { type: "ARMY_MARCHING"; armyId: string; campId: string; groupId?: string; fromX: number; fromY: number; toX: number; toY: number; arrivesAtMs: number }
  | { type: "ARMY_ARRIVED"; armyId: string; campId: string; groupId?: string; x: number; y: number }
  | { type: "TRADE"; campAId: string; campBId: string; nameA: string; nameB: string }
  | { type: "GROUP_SPAWNED"; groupId: string; campId?: string; unitCount: number; archetype: string }
  | { type: "BOSS_SPAWNED"; groupId: string; groupName: string; x: number; y: number }
  | { type: "GROUP_DISBANDED"; groupId: string }
  | { type: "GROUP_DEFEATED"; loserGroupId: string; winnerGroupId: string; survivorCount: number; profileId?: string }
  | { type: "GROUP_STATE_CHANGED"; groupId: string; from: string; to: string }
  | { type: "GROUP_ENGAGED"; groupAId: string; groupBId: string; nameA: string; nameB: string }
  | { type: "PLAYER_ENGAGED_GROUP"; profileId: string; groupId: string; groupName: string }
  | { type: "COMBAT_INTENSITY"; profileId?: string; groupId?: string; intensity: number; phase: "building" | "peak" | "cooldown" }
  | { type: "GROUP_RESTING"; groupId: string; campId?: string }
  | { type: "GROUP_DEPARTED"; groupId: string; campId?: string; fromX: number; fromY: number; toX: number; toY: number }
  | { type: "BARB_UNIT_HIT"; attackerUnitId: string; targetUnitId: string; damage: number; remainingHp: number; groupId: string }
  | { type: "PLAYER_UNIT_HIT"; attackerUnitId: string; targetUnitId: string; damage: number; remainingHp: number; groupId: string }
  | { type: "COMBAT_BURST"; hits: Array<{ attackerUnitId: string; targetUnitId: string; damage: number; remainingHp: number; groupId: string }> }
  | { type: "PVP_UNIT_HIT"; attackerUnitId: string; targetUnitId: string; attackerProfileId: string; targetProfileId: string; damage: number; remainingHp: number }
  | { type: "PVP_COMBAT_BURST"; hits: Array<{ attackerUnitId: string; targetUnitId: string; attackerProfileId: string; targetProfileId: string; damage: number; remainingHp: number }> }
  | { type: "PVP_COMBAT_END"; reason: "retreat" | "elimination" | "cancelled"; attackerProfileId?: string; defenderProfileId?: string; winnerProfileId?: string; loserProfileId?: string }
  | { type: "BARB_UNIT_KILLED"; unitId: string; name: string; groupId: string; killerUnitId?: string }
  | { type: "SEASON_CHANGED"; season: string; phase: string }
  | { type: "CITY_FOUNDED"; cityId: string; name: string; botProfile: string; x: number; y: number }
  | { type: "CITY_ATTACKED"; attackerId: string; defenderId: string; attackerName: string; defenderName: string; outcome: "WIN" | "LOSS" }
  | { type: "BARB_ATTACKS_CITY"; campId: string; cityId: string; campName: string; cityName: string; outcome: "WIN" | "LOSS" }
  | { type: "BUILDING_COMPLETED"; cityId: string; buildingType: string }
  | { type: "RESEARCH_COMPLETED"; cityId: string; techId: string }
  | { type: "UNITS_TRAINED"; cityId: string; unitType: string; count: number }
  | { type: "ATTACK_RESOLVED"; attackerId: string; defenderId: string; attackerKind: "CITY" | "CAMP"; defenderKind: "CITY" | "CAMP"; attackerName: string; defenderName: string; outcome: "WIN" | "LOSS"; x: number; y: number }
  | { type: "UNIT_LEVEL_UP"; unitId: string; unitName: string; level: number; profileId?: string }
  | { type: "GOLD_GAINED"; profileId: string; amount: number; reason: string; totalGold: number }
  | { type: "GOLD_LOST"; profileId: string; amount: number; reason: string; totalGold: number }
  | { type: "SQUAD_UNSTUCK"; profileId: string; unitsMoved: number }
  | { type: "SQUAD_WIPED"; profileId: string; killerType: "barbarians" | "player"; killerName?: string };
