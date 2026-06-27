/** Tactical order helpers — posture derivation and gesture inference (Phase G). */
export const UnitOrder = {
  MOVE: "move",
  HOLD: "hold",
  ATTACK_MOVE: "attack_move",
  FIRE_HOLD: "fire_hold",
  STEALTH: "stealth",
} as const;

export type UnitOrderValue = (typeof UnitOrder)[keyof typeof UnitOrder];

export const POSTURE_PRIORITY: UnitOrderValue[] = [
  UnitOrder.FIRE_HOLD,
  UnitOrder.HOLD,
  UnitOrder.STEALTH,
  UnitOrder.ATTACK_MOVE,
  UnitOrder.MOVE,
];

export const POSTURE_LABELS: Record<UnitOrderValue, string> = {
  [UnitOrder.MOVE]: "MARCHA",
  [UnitOrder.ATTACK_MOVE]: "MARCHA",
  [UnitOrder.HOLD]: "HOLD",
  [UnitOrder.FIRE_HOLD]: "FUEGO",
  [UnitOrder.STEALTH]: "SIGILO",
};

export type SquadUnit = {
  hp: number;
  unitOrder?: UnitOrderValue | string;
  orderQueue?: unknown[];
  path?: unknown[];
  pathIdx?: number;
};

export type SquadPosture = { order: UnitOrderValue; label: string };

/** Majority unitOrder among alive squad units; tie-break by POSTURE_PRIORITY. */
export function deriveSquadPosture(units: SquadUnit[] | null | undefined): SquadPosture | null {
  const alive = (units ?? []).filter(u => u.hp > 0);
  if (!alive.length) return null;
  const counts: Partial<Record<UnitOrderValue, number>> = {};
  for (const u of alive) {
    const o = (u.unitOrder || UnitOrder.MOVE) as UnitOrderValue;
    counts[o] = (counts[o] || 0) + 1;
  }
  let best: UnitOrderValue = UnitOrder.MOVE;
  let bestCount = 0;
  for (const o of POSTURE_PRIORITY) {
    const c = counts[o] || 0;
    if (c > bestCount) {
      bestCount = c;
      best = o;
    }
  }
  return { order: best, label: POSTURE_LABELS[best] || "MARCHA" };
}

/** Shift+RMB: waypoint if route/queue active, else fire-hold. Plain RMB: attack-move. */
export function inferTerrainGesture(
  shift: boolean,
  hasActiveRoute: boolean,
): typeof UnitOrder.ATTACK_MOVE | "waypoint" | "fire_hold" {
  if (shift) return hasActiveRoute ? "waypoint" : "fire_hold";
  return UnitOrder.ATTACK_MOVE;
}

export function isNearSquadPosition(
  destX: number,
  destY: number,
  centerX: number | null | undefined,
  centerY: number | null | undefined,
  threshold = 3,
): boolean {
  if (centerX == null || centerY == null) return false;
  return Math.hypot(destX - centerX, destY - centerY) < threshold;
}

export function squadHasActiveRoute(units: SquadUnit[] | null | undefined): boolean {
  return (units ?? []).some(
    u =>
      (u.orderQueue?.length ?? 0) > 0 ||
      ((u.path?.length ?? 0) > 0 && (u.pathIdx ?? 0) < (u.path?.length ?? 0)),
  );
}

/** Resolve RMB terrain gesture including hold-on-self when near centroid. */
export function resolveTerrainOrder(params: {
  shift: boolean;
  destX: number;
  destY: number;
  centerX: number | null | undefined;
  centerY: number | null | undefined;
  units: SquadUnit[] | null | undefined;
}): "hold" | "fire_hold" | "waypoint" | typeof UnitOrder.ATTACK_MOVE {
  const { shift, destX, destY, centerX, centerY, units } = params;
  if (!shift && isNearSquadPosition(destX, destY, centerX, centerY)) return "hold";
  const gesture = inferTerrainGesture(shift, squadHasActiveRoute(units));
  return gesture;
}
