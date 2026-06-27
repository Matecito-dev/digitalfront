/** Tactical order helpers — posture derivation and gesture inference (Phase G).
 *  Keep in sync with scripts/tacticalOrders.ts (tests import the TS module). */
(function () {
  const UnitOrder = {
    MOVE: 'move',
    HOLD: 'hold',
    ATTACK_MOVE: 'attack_move',
    FIRE_HOLD: 'fire_hold',
    STEALTH: 'stealth',
  };

  const POSTURE_PRIORITY = [
    UnitOrder.FIRE_HOLD,
    UnitOrder.HOLD,
    UnitOrder.STEALTH,
    UnitOrder.ATTACK_MOVE,
    UnitOrder.MOVE,
  ];

  const POSTURE_LABELS = {
    [UnitOrder.MOVE]: 'MARCHA',
    [UnitOrder.ATTACK_MOVE]: 'MARCHA',
    [UnitOrder.HOLD]: 'HOLD',
    [UnitOrder.FIRE_HOLD]: 'FUEGO',
    [UnitOrder.STEALTH]: 'SIGILO',
  };

  function deriveSquadPosture(units) {
    const alive = (units ?? []).filter(u => u.hp > 0);
    if (!alive.length) return null;
    const counts = {};
    for (const u of alive) {
      const o = u.unitOrder || UnitOrder.MOVE;
      counts[o] = (counts[o] || 0) + 1;
    }
    let best = UnitOrder.MOVE;
    let bestCount = 0;
    for (const o of POSTURE_PRIORITY) {
      const c = counts[o] || 0;
      if (c > bestCount) {
        bestCount = c;
        best = o;
      }
    }
    return { order: best, label: POSTURE_LABELS[best] || 'MARCHA' };
  }

  function inferTerrainGesture(shift, hasActiveRoute) {
    if (shift) return hasActiveRoute ? 'waypoint' : 'fire_hold';
    return UnitOrder.ATTACK_MOVE;
  }

  function isNearSquadPosition(destX, destY, centerX, centerY, threshold = 3) {
    if (centerX == null || centerY == null) return false;
    return Math.hypot(destX - centerX, destY - centerY) < threshold;
  }

  function squadHasActiveRoute(units) {
    return (units ?? []).some(u =>
      (u.orderQueue?.length > 0) ||
      (u.path?.length > 0 && (u.pathIdx ?? 0) < u.path.length),
    );
  }

  const TacticalOrders = {
    UnitOrder,
    POSTURE_LABELS,
    POSTURE_PRIORITY,
    deriveSquadPosture,
    inferTerrainGesture,
    isNearSquadPosition,
    squadHasActiveRoute,
  };

  if (typeof window !== 'undefined') window.TacticalOrders = TacticalOrders;
  if (typeof module !== 'undefined') module.exports = TacticalOrders;
})();
