// Barbarian AI: autonomous behaviors — move, duel, trade, level-up from combat.
// All functions are called from queueWorker on a slow tick (~5 min cadence).

import { prisma } from '@etheria/database';
import { resolveBattle } from './battles.js';
import { isBuildableTerrain, isPathReachable, calculatePathSpeedMultiplier } from './worldTerrainConfigData.js';
import { LOCAL_WORLD_CONFIG } from './worldConfigData.js';

const BARBARIAN_SPEED_PX_PER_SEC = 22;

// Per-region cap so barbarian relocations stay distributed across the map instead
// of all clustering into one area ("líneas para todos lados"). The world is split
// into REGION_DIM×REGION_DIM cells; each may host at most MAX_MOVES_PER_REGION
// concurrent marches originating inside it.
const REGION_DIM = 4;
const MAX_MOVES_PER_REGION = 2;

function regionKey(x: number, y: number, width: number, height: number): number {
  const nx = Math.min(REGION_DIM - 1, Math.max(0, Math.floor(((x + width / 2) / width) * REGION_DIM)));
  const ny = Math.min(REGION_DIM - 1, Math.max(0, Math.floor(((y + height / 2) / height) * REGION_DIM)));
  return ny * REGION_DIM + nx;
}

// ─── World chronicle ──────────────────────────────────────────────────────────
// Spanish archetype labels for the activity feed, and a thin helper that writes
// emergent barbarian events into the existing feed so the world feels alive.

const ARCHETYPE_ES: Record<string, string> = {
  RAIDERS:   'los Saqueadores',
  MARAUDERS: 'los Merodeadores',
  WARHOST:   'la Horda de Guerra',
  HUNTERS:   'los Cazadores',
  NOMADS:    'los Nómadas',
};

async function chronicle(
  type: string,
  actorName: string,
  actorId: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const { createActivityFeedEntry } = await import('../routes/activityFeed.js');
    await createActivityFeedEntry(type, actorName, actorId, payload, true);
  } catch {
    // Feed write is best-effort; never block AI on it.
  }
}

type ChronicleCamp = { id: string; name: string; archetype: string; level: number };

async function chronicleDuel(
  winner: ChronicleCamp,
  loser: ChronicleCamp,
  levelGain: number
): Promise<void> {
  const winnerLevel = winner.level + levelGain;
  // A camp that levels up past 6 becomes a feared warlord — rarer, epic event.
  if (levelGain && winnerLevel >= 6) {
    await chronicle('WORLD_BARBARIAN_WARLORD', winner.name, winner.id, {
      archetype: ARCHETYPE_ES[winner.archetype] ?? winner.archetype,
      level: winnerLevel,
      defeated: loser.name,
    });
    return;
  }
  await chronicle('WORLD_BARBARIAN_CLASH', winner.name, winner.id, {
    winnerArchetype: ARCHETYPE_ES[winner.archetype] ?? winner.archetype,
    loserArchetype: ARCHETYPE_ES[loser.archetype] ?? loser.archetype,
    loser: loser.name,
  });
}

// ─── Archetype relationships ──────────────────────────────────────────────────

const RIVAL_OF: Record<string, string[]> = {
  RAIDERS:   ['MARAUDERS', 'NOMADS'],
  MARAUDERS: ['RAIDERS', 'WARHOST'],
  WARHOST:   ['MARAUDERS'],
  HUNTERS:   [],
  NOMADS:    ['RAIDERS'],
};

const TRADES_WITH: Record<string, string[]> = {
  HUNTERS:   ['NOMADS', 'HUNTERS'],
  NOMADS:    ['HUNTERS', 'NOMADS', 'RAIDERS'],
  RAIDERS:   ['NOMADS'],
  MARAUDERS: [],
  WARHOST:   [],
};

const MOVE_CHANCE: Record<string, number> = {
  NOMADS:    0.008,
  RAIDERS:   0.004,
  HUNTERS:   0.004,
  MARAUDERS: 0.002,
  WARHOST:   0.001,
};

// Cooldown hours between actions per archetype (move)
const MOVE_COOLDOWN_HOURS: Record<string, number> = {
  NOMADS:    6,
  RAIDERS:   18,
  HUNTERS:   12,
  MARAUDERS: 24,
  WARHOST:   48,
};
const DUEL_COOLDOWN_HOURS  = 24;
const TRADE_COOLDOWN_HOURS = 16;

const MAX_ACTIVE_MOVES  = 8;
const MAX_ACTIVE_DUELS  = 4;
const MAX_ACTIVE_TRADES = 6;

const DUEL_RADIUS  = 18_000;
const TRADE_RADIUS = 22_000;
const MOVE_RADIUS  = 12_000;

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function travelSecs(d: number) {
  return Math.max(120, Math.floor(d / BARBARIAN_SPEED_PX_PER_SEC));
}

// Travel time that accounts for the detour around water/mountains, so the stored
// ETA matches the (longer) route the client actually animates the icon along —
// fixing icons that "raced" because timing used straight-line distance.
function pathTravelSecs(fx: number, fy: number, tx: number, ty: number, width: number, height: number) {
  const straight = dist(fx, fy, tx, ty);
  const mult = calculatePathSpeedMultiplier(fx, fy, tx, ty, width, height);
  return travelSecs(straight / Math.max(0.15, mult));
}

// ─── Movement intelligence helpers ───────────────────────────────────────────

function angleAwayFromCluster(
  camp: { posX: number; posY: number },
  others: { posX: number; posY: number }[]
): number {
  let cx = 0, cy = 0, n = 0;
  for (const o of others) {
    const d = Math.hypot(o.posX - camp.posX, o.posY - camp.posY);
    if (d < 8_000 && d > 0) { cx += o.posX; cy += o.posY; n++; }
  }
  if (n === 0) return Math.random() * Math.PI * 2;
  return Math.atan2(camp.posY - cy / n, camp.posX - cx / n);
}

function getBiasedDestination(
  camp: { posX: number; posY: number; archetype: string },
  allCamps: { posX: number; posY: number }[],
  cities: { posX: number; posY: number; power: number }[]
): { angle: number; minDist: number; maxDist: number } {
  switch (camp.archetype) {
    case 'NOMADS': {
      const nearbyCount = allCamps.filter(
        c => Math.hypot(c.posX - camp.posX, c.posY - camp.posY) < 8_000
      ).length;
      const fleeAngle = nearbyCount > 5
        ? angleAwayFromCluster(camp, allCamps)
        : Math.random() * Math.PI * 2;
      return { angle: fleeAngle, minDist: 6_000, maxDist: 14_000 };
    }
    case 'HUNTERS':
      return { angle: Math.random() * Math.PI * 2, minDist: 3_000, maxDist: 7_000 };
    case 'RAIDERS': {
      const weakCity = cities
        .filter(c => Math.hypot(c.posX - camp.posX, c.posY - camp.posY) < 15_000 && c.power < 500)
        .sort((a, b) => a.power - b.power)[0];
      if (weakCity) {
        const dx = weakCity.posX - camp.posX, dy = weakCity.posY - camp.posY;
        return { angle: Math.atan2(dy, dx), minDist: 2_000, maxDist: 5_000 };
      }
      return { angle: Math.random() * Math.PI * 2, minDist: 4_000, maxDist: 10_000 };
    }
    case 'MARAUDERS': {
      const richCity = cities
        .filter(c => Math.hypot(c.posX - camp.posX, c.posY - camp.posY) < 20_000 && c.power > 200)
        .sort((a, b) => b.power - a.power)[0];
      if (richCity) {
        const dx = richCity.posX - camp.posX, dy = richCity.posY - camp.posY;
        return { angle: Math.atan2(dy, dx), minDist: 3_000, maxDist: 8_000 };
      }
      return { angle: Math.random() * Math.PI * 2, minDist: 4_000, maxDist: 12_000 };
    }
    default:
      return { angle: Math.random() * Math.PI * 2, minDist: 5_000, maxDist: 16_000 };
  }
}

// ─── BARBARIAN MOVE ───────────────────────────────────────────────────────────

export async function processBarbarianMoves(): Promise<void> {
  // Resolve arrived moves first
  const arrived = await prisma.barbarianMove.findMany({
    where: { status: 'MARCHING', arrivesAt: { lte: new Date() } },
  });
  for (const m of arrived) {
    await prisma.$transaction([
      prisma.barbarianCamp.update({
        where: { id: m.campId },
        data: { posX: m.toX, posY: m.toY },
      }),
      prisma.barbarianMove.update({
        where: { id: m.id },
        data: { status: 'ARRIVED' },
      }),
    ]);
  }
  // Clean up old arrived moves
  await prisma.barbarianMove.deleteMany({
    where: { status: 'ARRIVED', arrivesAt: { lte: new Date(Date.now() - 2 * 3600_000) } },
  });

  const { width, height } = LOCAL_WORLD_CONFIG.map;

  // Enforce global cap — delete oldest MARCHING moves if over the limit
  const activeMoves = await prisma.barbarianMove.findMany({
    where: { status: 'MARCHING' },
    orderBy: { startedAt: 'asc' },
    select: { id: true, fromX: true, fromY: true },
  });
  if (activeMoves.length > MAX_ACTIVE_MOVES) {
    const toDelete = activeMoves.slice(0, activeMoves.length - MAX_ACTIVE_MOVES).map(m => m.id);
    await prisma.barbarianMove.deleteMany({ where: { id: { in: toDelete } } });
    activeMoves.splice(0, activeMoves.length - MAX_ACTIVE_MOVES);
  }
  const activeCount = activeMoves.length;
  if (activeCount >= MAX_ACTIVE_MOVES) return;

  // Tally active marches per region so we keep new ones spread across the map.
  const regionCounts = new Map<number, number>();
  for (const m of activeMoves) {
    const k = regionKey(m.fromX, m.fromY, width, height);
    regionCounts.set(k, (regionCounts.get(k) ?? 0) + 1);
  }

  const camps = await prisma.barbarianCamp.findMany({
    where: { status: 'ACTIVE' },
    include: { moves: { where: { status: 'MARCHING' } } },
  });

  const cities = await prisma.city.findMany({ select: { posX: true, posY: true, power: true } });

  let created = 0;
  const allCampPositions = camps.map(c => ({ posX: c.posX, posY: c.posY }));

  for (const camp of camps) {
    if (activeCount + created >= MAX_ACTIVE_MOVES) break;
    if (camp.moves.length > 0) continue;

    // Per-region cap: don't pile more marches into an already-busy area.
    const campRegion = regionKey(camp.posX, camp.posY, width, height);
    if ((regionCounts.get(campRegion) ?? 0) >= MAX_MOVES_PER_REGION) continue;

    const cooldownHours = MOVE_COOLDOWN_HOURS[camp.archetype] ?? 4;
    if (camp.lastActionAt) {
      const hoursSince = (Date.now() - camp.lastActionAt.getTime()) / 3_600_000;
      if (hoursSince < cooldownHours) continue;
    }

    const chance = MOVE_CHANCE[camp.archetype] ?? 0.01;
    if (Math.random() > chance) continue;

    const bias = getBiasedDestination(camp, allCampPositions, cities);

    // Find last move to detect ping-pong
    const lastMove = await prisma.barbarianMove.findFirst({
      where: { campId: camp.id },
      orderBy: { arrivesAt: 'desc' },
    });

    let toX = 0, toY = 0, validDest = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      // Add jitter to the biased angle
      const angle = bias.angle + (Math.random() - 0.5) * Math.PI * 0.8;
      const d = bias.minDist + Math.random() * (bias.maxDist - bias.minDist);
      const cx = Math.round(camp.posX + Math.cos(angle) * d);
      const cy = Math.round(camp.posY + Math.sin(angle) * d);

      if (!isBuildableTerrain(cx, cy, width, height)) continue;
      if (Math.hypot(cx - camp.posX, cy - camp.posY) < 2_500) continue;
      if (lastMove && Math.hypot(cx - lastMove.fromX, cy - lastMove.fromY) < 3_000) continue;
      // Only commit to destinations actually reachable on foot (no water-locked targets).
      if (!isPathReachable(camp.posX, camp.posY, cx, cy, width, height)) continue;

      toX = cx; toY = cy; validDest = true; break;
    }
    if (!validDest) continue;

    const travel = pathTravelSecs(camp.posX, camp.posY, toX, toY, width, height);
    const now = new Date();
    await prisma.$transaction([
      prisma.barbarianMove.create({
        data: {
          id: crypto.randomUUID(),
          campId: camp.id,
          fromX: camp.posX,
          fromY: camp.posY,
          toX,
          toY,
          status: 'MARCHING',
          startedAt: now,
          arrivesAt: new Date(now.getTime() + travel * 1000),
        },
      }),
      prisma.barbarianCamp.update({
        where: { id: camp.id },
        data: { lastActionAt: now },
      }),
    ]);
    regionCounts.set(campRegion, (regionCounts.get(campRegion) ?? 0) + 1);
    created++;
  }
}

// ─── BARBARIAN VS BARBARIAN DUELS ─────────────────────────────────────────────

export async function processBarbarianDuels(): Promise<void> {
  // Resolve arrived duels
  const arrived = await prisma.barbarianDuel.findMany({
    where: { status: 'MARCHING', arrivesAt: { lte: new Date() } },
    include: {
      attackerCamp: { include: { army: true } },
      defenderCamp: { include: { army: true } },
    },
  });

  for (const duel of arrived) {
    const { attackerCamp, defenderCamp } = duel;
    if (!attackerCamp.army || !defenderCamp.army) {
      await prisma.barbarianDuel.update({ where: { id: duel.id }, data: { status: 'RESOLVED', resolvedAt: new Date(), result: { skipped: true } } });
      continue;
    }

    const attackerUnits = attackerCamp.army.units as Record<string, number>;
    const defenderUnits = defenderCamp.army.units as Record<string, number>;

    const battleResult = resolveBattle(attackerUnits as any, defenderUnits as any);

    const now = new Date();
    if (battleResult.victory) {
      const absorbed: Record<string, number> = {};
      for (const [type, count] of Object.entries(defenderUnits)) {
        absorbed[type] = Math.floor(count * 0.4);
      }
      const newAttackerUnits = { ...attackerUnits };
      for (const [type, count] of Object.entries(absorbed)) {
        newAttackerUnits[type] = (newAttackerUnits[type] ?? 0) + count;
      }
      const newAttackerPower = Object.values(newAttackerUnits).reduce((s, n) => s + n, 0) * 10;

      const newDefenderUnits: Record<string, number> = {};
      for (const [type, count] of Object.entries(defenderUnits)) {
        newDefenderUnits[type] = Math.max(0, Math.floor(count * 0.5));
      }
      const newDefenderPower = Object.values(newDefenderUnits).reduce((s, n) => s + n, 0) * 10;

      const levelGain = Math.random() < 0.4 && attackerCamp.level < 10 ? 1 : 0;

      await prisma.$transaction([
        prisma.barbarianArmy.update({
          where: { campId: attackerCamp.id },
          data: { units: newAttackerUnits, power: newAttackerPower },
        }),
        prisma.barbarianArmy.update({
          where: { campId: defenderCamp.id },
          data: { units: newDefenderUnits, power: newDefenderPower },
        }),
        ...(levelGain ? [prisma.barbarianCamp.update({
          where: { id: attackerCamp.id },
          data: { level: attackerCamp.level + 1 },
        })] : []),
        prisma.barbarianDuel.update({
          where: { id: duel.id },
          data: { status: 'RESOLVED', resolvedAt: now, result: { winner: 'ATTACKER', levelGain } },
        }),
      ]);
      await chronicleDuel(attackerCamp, defenderCamp, levelGain);
    } else {
      const newAttackerUnits: Record<string, number> = {};
      for (const [type, count] of Object.entries(attackerUnits)) {
        newAttackerUnits[type] = Math.max(0, Math.floor(count * 0.5));
      }
      const absorbed: Record<string, number> = {};
      for (const [type, count] of Object.entries(attackerUnits)) {
        absorbed[type] = Math.floor(count * 0.3);
      }
      const newDefenderUnits = { ...defenderUnits };
      for (const [type, count] of Object.entries(absorbed)) {
        newDefenderUnits[type] = (newDefenderUnits[type] ?? 0) + count;
      }

      const levelGain = Math.random() < 0.4 && defenderCamp.level < 10 ? 1 : 0;

      await prisma.$transaction([
        prisma.barbarianArmy.update({
          where: { campId: attackerCamp.id },
          data: { units: newAttackerUnits, power: Object.values(newAttackerUnits).reduce((s, n) => s + n, 0) * 10 },
        }),
        prisma.barbarianArmy.update({
          where: { campId: defenderCamp.id },
          data: { units: newDefenderUnits, power: Object.values(newDefenderUnits).reduce((s, n) => s + n, 0) * 10 },
        }),
        ...(levelGain ? [prisma.barbarianCamp.update({
          where: { id: defenderCamp.id },
          data: { level: defenderCamp.level + 1 },
        })] : []),
        prisma.barbarianDuel.update({
          where: { id: duel.id },
          data: { status: 'RESOLVED', resolvedAt: now, result: { winner: 'DEFENDER', levelGain } },
        }),
      ]);
      await chronicleDuel(defenderCamp, attackerCamp, levelGain);
    }
  }

  // Enforce global cap — delete oldest MARCHING duels if over the limit
  const activeDuels = await prisma.barbarianDuel.findMany({
    where: { status: 'MARCHING' },
    orderBy: { startedAt: 'asc' },
    select: { id: true },
  });
  if (activeDuels.length > MAX_ACTIVE_DUELS) {
    const toDelete = activeDuels.slice(0, activeDuels.length - MAX_ACTIVE_DUELS).map(d => d.id);
    await prisma.barbarianDuel.deleteMany({ where: { id: { in: toDelete } } });
  }
  const activeCount = activeDuels.length - Math.max(0, activeDuels.length - MAX_ACTIVE_DUELS);
  if (activeCount >= MAX_ACTIVE_DUELS) {
    await prisma.barbarianDuel.deleteMany({
      where: { status: 'RESOLVED', resolvedAt: { lte: new Date(Date.now() - 2 * 3600_000) } },
    });
    return;
  }

  const activeCamps = await prisma.barbarianCamp.findMany({
    where: { status: 'ACTIVE' },
    include: {
      army: true,
      duelsAsAttacker: { where: { status: 'MARCHING' } },
      duelsAsDefender: { where: { status: 'MARCHING' } },
    },
  });

  const busyCampIds = new Set<string>();
  for (const c of activeCamps) {
    if (c.duelsAsAttacker.length > 0 || c.duelsAsDefender.length > 0) {
      busyCampIds.add(c.id);
    }
  }

  const freeCamps = activeCamps.filter(c => !busyCampIds.has(c.id));
  const pairedThisTick = new Set<string>();
  let created = 0;

  for (const attacker of freeCamps) {
    if (activeCount + created >= MAX_ACTIVE_DUELS) break;
    if (pairedThisTick.has(attacker.id)) continue;
    const rivals = RIVAL_OF[attacker.archetype] ?? [];
    if (rivals.length === 0) continue;

    // Cooldown check
    if (attacker.lastActionAt) {
      const hoursSince = (Date.now() - attacker.lastActionAt.getTime()) / 3_600_000;
      if (hoursSince < DUEL_COOLDOWN_HOURS) continue;
    }

    if (Math.random() > 0.03) continue;

    // Score candidates: prefer more powerful + closer rivals
    const candidates = freeCamps
      .filter(c =>
        !pairedThisTick.has(c.id) &&
        c.id !== attacker.id &&
        rivals.includes(c.archetype) &&
        dist(attacker.posX, attacker.posY, c.posX, c.posY) <= DUEL_RADIUS
      )
      .map(c => ({
        camp: c,
        score: (c.army?.power ?? 0) * 0.6 +
          (1 - dist(attacker.posX, attacker.posY, c.posX, c.posY) / DUEL_RADIUS) * 0.4,
      }))
      .sort((a, b) => b.score - a.score);

    const target = candidates[0]?.camp;
    if (!target) continue;

    // Both camps march to the midpoint, so each covers ~half the route. Path-aware
    // so the ETA matches the curved route rendered on the map.
    const { width, height } = LOCAL_WORLD_CONFIG.map;
    const travel = Math.max(120, Math.floor(pathTravelSecs(attacker.posX, attacker.posY, target.posX, target.posY, width, height) / 2));
    const now = new Date();
    await prisma.$transaction([
      prisma.barbarianDuel.create({
        data: {
          id: crypto.randomUUID(),
          attackerCampId: attacker.id,
          defenderCampId: target.id,
          status: 'MARCHING',
          startedAt: now,
          arrivesAt: new Date(now.getTime() + travel * 1000),
        },
      }),
      prisma.barbarianCamp.update({ where: { id: attacker.id }, data: { lastActionAt: now } }),
      prisma.barbarianCamp.update({ where: { id: target.id }, data: { lastActionAt: now } }),
    ]);
    pairedThisTick.add(attacker.id);
    pairedThisTick.add(target.id);
    created++;
  }

  // Clean up old resolved duels
  await prisma.barbarianDuel.deleteMany({
    where: { status: 'RESOLVED', resolvedAt: { lte: new Date(Date.now() - 2 * 3600_000) } },
  });
}

// ─── BARBARIAN CAMP TRADE ─────────────────────────────────────────────────────

export async function processBarbarianCampTrades(): Promise<void> {
  const now = new Date();
  const { width, height } = LOCAL_WORLD_CONFIG.map;

  // Resolve arrivals → flip to RETURNING
  const arrived = await prisma.barbarianCampTrade.findMany({
    where: { status: 'MARCHING', arrivesAt: { lte: now } },
    include: { fromCamp: true, toCamp: true },
  });
  for (const trade of arrived) {
    const returnSecs = pathTravelSecs(trade.fromCamp.posX, trade.fromCamp.posY, trade.toCamp.posX, trade.toCamp.posY, width, height);
    await prisma.barbarianCampTrade.update({
      where: { id: trade.id },
      data: { status: 'RETURNING', returnsAt: new Date(now.getTime() + returnSecs * 1000) },
    });
  }

  // Resolve returns → DONE
  const returning = await prisma.barbarianCampTrade.findMany({
    where: { status: 'RETURNING', returnsAt: { lte: now } },
  });
  for (const trade of returning) {
    await prisma.barbarianCampTrade.update({ where: { id: trade.id }, data: { status: 'DONE' } });
  }

  // Clean up old done trades
  await prisma.barbarianCampTrade.deleteMany({
    where: { status: 'DONE', arrivesAt: { lte: new Date(Date.now() - 2 * 3600_000) } },
  });

  // Enforce global cap — delete oldest MARCHING trades if over the limit
  const activeTrades = await prisma.barbarianCampTrade.findMany({
    where: { status: { in: ['MARCHING', 'RETURNING'] } },
    orderBy: { startedAt: 'asc' },
    select: { id: true },
  });
  if (activeTrades.length > MAX_ACTIVE_TRADES) {
    const toDelete = activeTrades.slice(0, activeTrades.length - MAX_ACTIVE_TRADES).map(t => t.id);
    await prisma.barbarianCampTrade.deleteMany({ where: { id: { in: toDelete } } });
  }
  const activeCount = activeTrades.length - Math.max(0, activeTrades.length - MAX_ACTIVE_TRADES);
  if (activeCount >= MAX_ACTIVE_TRADES) return;

  const activeCamps = await prisma.barbarianCamp.findMany({
    where: { status: 'ACTIVE' },
    include: {
      tradesFrom: { where: { status: { in: ['MARCHING', 'RETURNING'] } } },
      tradesTo:   { where: { status: { in: ['MARCHING', 'RETURNING'] } } },
    },
  });

  const busyCampIds = new Set<string>();
  for (const c of activeCamps) {
    if (c.tradesFrom.length > 0 || c.tradesTo.length > 0) busyCampIds.add(c.id);
  }

  const freeCamps = activeCamps.filter(c => !busyCampIds.has(c.id));
  const pairedThisTick = new Set<string>();
  let created = 0;

  for (const sender of freeCamps) {
    if (activeCount + created >= MAX_ACTIVE_TRADES) break;
    if (pairedThisTick.has(sender.id)) continue;
    const partners = TRADES_WITH[sender.archetype] ?? [];
    if (partners.length === 0) continue;

    // Cooldown check
    if (sender.lastActionAt) {
      const hoursSince = (Date.now() - sender.lastActionAt.getTime()) / 3_600_000;
      if (hoursSince < TRADE_COOLDOWN_HOURS) continue;
    }

    if (Math.random() > 0.025) continue;

    const target = freeCamps.find(c =>
      !pairedThisTick.has(c.id) &&
      c.id !== sender.id &&
      partners.includes(c.archetype) &&
      dist(sender.posX, sender.posY, c.posX, c.posY) <= TRADE_RADIUS
    );
    if (!target) continue;

    const travel = pathTravelSecs(sender.posX, sender.posY, target.posX, target.posY, width, height);
    await prisma.$transaction([
      prisma.barbarianCampTrade.create({
        data: {
          id: crypto.randomUUID(),
          fromCampId: sender.id,
          toCampId: target.id,
          status: 'MARCHING',
          startedAt: now,
          arrivesAt: new Date(now.getTime() + travel * 1000),
        },
      }),
      prisma.barbarianCamp.update({ where: { id: sender.id }, data: { lastActionAt: now } }),
      prisma.barbarianCamp.update({ where: { id: target.id }, data: { lastActionAt: now } }),
    ]);
    pairedThisTick.add(sender.id);
    pairedThisTick.add(target.id);
    created++;
  }
}
