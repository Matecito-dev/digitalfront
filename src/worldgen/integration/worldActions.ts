import { prisma } from "@etheria/database";
import type { WorldMovement } from "@etheria/shared";
import { calculateWalkablePath, isBuildableTerrain } from "./worldTerrainConfigData.js";
import { LOCAL_WORLD_CONFIG } from "./worldConfigData.js";

// Short TTL cache: every connected client polls this endpoint every ~10s and
// the result is identical for all of them, so one computation serves everyone.
const MOVEMENTS_CACHE_TTL_MS = 8_000;
let movementsCache: { at: number; data: WorldMovement[] } | null = null;

/** Returns the arc-length midpoint of a path and the sub-path leading to it.
 * Used for barbarian duels so the meeting point always lies on the walkable
 * route (never the geometric midpoint, which can fall in water). */
function halfPath(path: { x: number; y: number }[]): { mid: { x: number; y: number }; sub: { x: number; y: number }[] } {
  if (path.length < 2) return { mid: path[0] ?? { x: 0, y: 0 }, sub: path };
  const seg: number[] = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    seg.push(total);
  }
  const half = total / 2;
  let i = 1;
  while (i < path.length - 1 && seg[i] < half) i++;
  const prev = path[i - 1], cur = path[i];
  const segLen = seg[i] - seg[i - 1];
  const t = segLen > 0 ? (half - seg[i - 1]) / segLen : 0;
  const mid = { x: Math.round(prev.x + (cur.x - prev.x) * t), y: Math.round(prev.y + (cur.y - prev.y) * t) };
  return { mid, sub: [...path.slice(0, i), mid] };
}

export async function getActiveMovements(): Promise<WorldMovement[]> {
  if (movementsCache && Date.now() - movementsCache.at < MOVEMENTS_CACHE_TTL_MS) {
    return movementsCache.data;
  }
  const data = await computeActiveMovements();
  movementsCache = { at: Date.now(), data };
  return data;
}

async function computeActiveMovements(): Promise<WorldMovement[]> {
  const now = new Date();
  const [battles, barbarianBattles, barbarianAttacks, caravans, barbarianMoves, duels, campTrades] = await Promise.all([
    prisma.battle.findMany({ where: { status: { in: ["MARCHING", "RETURNING"] as any } } }),
    prisma.barbarianBattle.findMany({ where: { status: { in: ["MARCHING", "RETURNING"] as any } } }),
    prisma.barbarianAttack.findMany({ where: { status: { in: ["MARCHING", "RETURNING"] as any } } }),
    prisma.tradeCaravan.findMany({ where: { status: { in: ["MARCHING", "RETURNING"] as any } } }),
    // Exclude stale MARCHING moves (arrivesAt already passed — cleanup job hasn't run yet)
    prisma.barbarianMove.findMany({ where: { status: 'MARCHING', arrivesAt: { gte: now } } }),
    prisma.barbarianDuel.findMany({ where: { status: 'MARCHING', arrivesAt: { gte: now } } }),
    prisma.barbarianCampTrade.findMany({ where: { status: { in: ['MARCHING', 'RETURNING'] } } }),
  ]);

  const cityIds = new Set<string>();
  const campIds = new Set<string>();
  for (const battle of battles) {
    cityIds.add(battle.attackerCityId);
    cityIds.add(battle.defenderCityId);
  }
  for (const battle of barbarianBattles) {
    cityIds.add(battle.attackerCityId);
    campIds.add(battle.targetCampId);
  }
  for (const raid of barbarianAttacks) {
    campIds.add(raid.campId);
    cityIds.add(raid.targetCityId);
  }
  for (const caravan of caravans) {
    cityIds.add(caravan.senderCityId);
    cityIds.add(caravan.recipientCityId);
  }
  for (const m of barbarianMoves) campIds.add(m.campId);
  for (const d of duels) { campIds.add(d.attackerCampId); campIds.add(d.defenderCampId); }
  for (const t of campTrades) { campIds.add(t.fromCampId); campIds.add(t.toCampId); }

  const [cities, camps] = await Promise.all([
    cityIds.size > 0
      ? prisma.city.findMany({
          where: { id: { in: [...cityIds] } },
          select: { id: true, name: true, posX: true, posY: true, userId: true, user: { select: { name: true } } },
        })
      : Promise.resolve([]),
    campIds.size > 0
      ? prisma.barbarianCamp.findMany({ where: { id: { in: [...campIds] } }, select: { id: true, name: true, posX: true, posY: true } })
      : Promise.resolve([]),
  ]);

  // Alliance membership of every involved city owner, for diplomacy coloring
  const userIds = [...new Set(cities.map((c) => c.userId))];
  const memberships = userIds.length > 0
    ? await prisma.allianceMember.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, allianceId: true, alliance: { select: { tag: true } } },
      })
    : [];
  const membershipByUser = new Map(memberships.map((m) => [m.userId, m]));

  const cityMap = new Map(cities.map(c => [c.id, c]));
  const campMap = new Map(camps.map(c => [c.id, c]));

  const ownerInfo = (cityId: string) => {
    const city = cityMap.get(cityId);
    if (!city) return {};
    const membership = membershipByUser.get(city.userId);
    return {
      playerName: city.user?.name ?? city.name,
      allianceId: membership?.allianceId,
      allianceTag: membership?.alliance?.tag,
    };
  };

  const movements: WorldMovement[] = [];
  const { width, height } = LOCAL_WORLD_CONFIG.map;
  const buildable = (x: number, y: number) => isBuildableTerrain(x, y, width, height);

  const getPath = (fx: number, fy: number, tx: number, ty: number) =>
    calculateWalkablePath(fx, fy, tx, ty, width, height);

  // Player vs Player Battles
  for (const battle of battles) {
    const attacker = cityMap.get(battle.attackerCityId);
    const defender = cityMap.get(battle.defenderCityId);
    if (!attacker || !defender) continue;

    movements.push({
      id: battle.id,
      type: "ATTACK",
      status: battle.status as "MARCHING" | "RETURNING",
      from: { x: attacker.posX, y: attacker.posY, name: attacker.name },
      to: { x: defender.posX, y: defender.posY, name: defender.name },
      startedAt: battle.startedAt.toISOString(),
      arrivesAt: battle.arrivesAt.toISOString(),
      resolvedAt: battle.resolvedAt?.toISOString(),
      returnsAt: battle.returnsAt?.toISOString(),
      path: getPath(attacker.posX, attacker.posY, defender.posX, defender.posY),
      ...ownerInfo(battle.attackerCityId),
    });
  }

  // Player vs Barbarian Battles
  for (const battle of barbarianBattles) {
    const attacker = cityMap.get(battle.attackerCityId);
    const camp = campMap.get(battle.targetCampId);
    if (!attacker || !camp) continue;

    movements.push({
      id: battle.id,
      type: "BARBARIAN_ATTACK",
      status: battle.status as "MARCHING" | "RETURNING",
      from: { x: attacker.posX, y: attacker.posY, name: attacker.name },
      to: { x: camp.posX, y: camp.posY, name: camp.name },
      startedAt: battle.startedAt.toISOString(),
      arrivesAt: battle.arrivesAt.toISOString(),
      resolvedAt: battle.resolvedAt?.toISOString(),
      returnsAt: battle.returnsAt?.toISOString(),
      path: getPath(attacker.posX, attacker.posY, camp.posX, camp.posY),
      ...ownerInfo(battle.attackerCityId),
    });
  }

  // Barbarian attacks against player cities
  for (const raid of barbarianAttacks) {
    const camp = campMap.get(raid.campId);
    const defender = cityMap.get(raid.targetCityId);
    if (!camp || !defender) continue;

    movements.push({
      id: raid.id,
      type: "BARBARIAN_RAID",
      status: raid.status as "MARCHING" | "RETURNING",
      from: { x: camp.posX, y: camp.posY, name: camp.name },
      to: { x: defender.posX, y: defender.posY, name: defender.name },
      startedAt: raid.startedAt.toISOString(),
      arrivesAt: raid.arrivesAt.toISOString(),
      resolvedAt: raid.resolvedAt?.toISOString(),
      returnsAt: raid.returnsAt?.toISOString(),
      path: getPath(camp.posX, camp.posY, defender.posX, defender.posY),
    });
  }

  // Trade Caravans
  for (const caravan of caravans) {
    const sender = cityMap.get(caravan.senderCityId);
    const recipient = cityMap.get(caravan.recipientCityId);
    if (!sender || !recipient) continue;

    movements.push({
      id: caravan.id,
      type: "TRADE",
      status: caravan.status as "MARCHING" | "RETURNING",
      from: { x: sender.posX, y: sender.posY, name: sender.name },
      to: { x: recipient.posX, y: recipient.posY, name: recipient.name },
      startedAt: caravan.startedAt.toISOString(),
      arrivesAt: caravan.arrivesAt.toISOString(),
      resolvedAt: caravan.completedAt?.toISOString(),
      returnsAt: undefined,
      path: getPath(sender.posX, sender.posY, recipient.posX, recipient.posY),
      ...ownerInfo(caravan.senderCityId),
    });
  }

  // Barbarian moves (relocation)
  for (const m of barbarianMoves) {
    const camp = campMap.get(m.campId);
    if (!camp) continue;
    // Skip stale records with water destinations (pre-terrain-check data)
    if (!buildable(m.toX, m.toY)) continue;
    movements.push({
      id: m.id,
      type: "BARBARIAN_MOVE",
      status: "MARCHING",
      from: { x: m.fromX, y: m.fromY, name: camp.name },
      to: { x: m.toX, y: m.toY, name: camp.name },
      startedAt: m.startedAt.toISOString(),
      arrivesAt: m.arrivesAt.toISOString(),
      path: getPath(m.fromX, m.fromY, m.toX, m.toY),
    });
  }

  // Barbarian vs Barbarian duels
  for (const d of duels) {
    const attacker = campMap.get(d.attackerCampId);
    const defender = campMap.get(d.defenderCampId);
    if (!attacker || !defender) continue;
    // Skip if either camp is in water (stale data)
    if (!buildable(attacker.posX, attacker.posY) || !buildable(defender.posX, defender.posY)) continue;
    const { mid, sub } = halfPath(getPath(attacker.posX, attacker.posY, defender.posX, defender.posY));
    movements.push({
      id: d.id,
      type: "BARBARIAN_VS_BARBARIAN",
      status: "MARCHING",
      from: { x: attacker.posX, y: attacker.posY, name: attacker.name },
      to: { x: mid.x, y: mid.y, name: `${attacker.name} vs ${defender.name}` },
      startedAt: d.startedAt.toISOString(),
      arrivesAt: d.arrivesAt.toISOString(),
      path: sub,
    });
  }

  // Barbarian camp trades
  for (const t of campTrades) {
    const from = campMap.get(t.fromCampId);
    const to = campMap.get(t.toCampId);
    if (!from || !to) continue;
    if (!buildable(from.posX, from.posY) || !buildable(to.posX, to.posY)) continue;
    // Skip RETURNING trades that already expired
    if (t.status === 'RETURNING' && t.returnsAt && t.returnsAt < now) continue;
    movements.push({
      id: t.id,
      type: "BARBARIAN_TRADE",
      status: t.status as "MARCHING" | "RETURNING",
      from: { x: from.posX, y: from.posY, name: from.name },
      to: { x: to.posX, y: to.posY, name: to.name },
      startedAt: t.startedAt.toISOString(),
      arrivesAt: t.arrivesAt.toISOString(),
      returnsAt: t.returnsAt?.toISOString(),
      path: getPath(from.posX, from.posY, to.posX, to.posY),
    });
  }

  return movements;
}
