import type pg from "pg";
import type { SimEvent } from "../sim/events.js";
import type { WorldState } from "../sim/worldState.js";

export const PUBLIC_CHRONICLE_MIN_WEIGHT = 2;

export interface ChronicleContext {
  captainNames: Map<string, string>;
  groupNames: Map<string, string>;
  groupPositions: Map<string, { x: number; y: number }>;
}

export interface ChronicleEntry {
  id: string;
  headline: string;
  body: string;
  weight: number;
  isPublic: boolean;
  simTimeMs: number;
  eventType: string;
  actorProfileId?: string;
}

export function buildChronicleContext(state: WorldState): ChronicleContext {
  const captainNames = new Map<string, string>();
  for (const [profileId, squad] of state.playerSquads) {
    captainNames.set(profileId, squad.captainName);
  }
  const groupNames = new Map<string, string>();
  const groupPositions = new Map<string, { x: number; y: number }>();
  for (const [id, group] of state.barbarianGroups) {
    groupNames.set(id, group.name);
    const alive = group.units.filter(u => u.hp > 0);
    if (alive.length) {
      let cx = 0;
      let cy = 0;
      for (const u of alive) { cx += u.x; cy += u.y; }
      groupPositions.set(id, { x: cx / alive.length, y: cy / alive.length });
    }
  }
  return { captainNames, groupNames, groupPositions };
}

export function eventWeight(event: SimEvent): number {
  switch (event.type) {
    case "GROUP_DEFEATED":
      if (event.winnerGroupId === "player" && event.profileId) {
        return 4;
      }
      return 2;
    case "CITY_ATTACKED":
    case "BARB_ATTACKS_CITY":
      return event.outcome === "WIN" ? 5 : 3;
    case "CAMP_DEFEATED":
      return 4;
    case "CITY_FOUNDED":
    case "SEASON_CHANGED":
      return 3;
    case "GROUP_ENGAGED":
      return 2;
    case "ATTACK_RESOLVED":
      return 3;
    case "PVP_COMBAT_END":
      return event.reason === "elimination" ? 5 : 4;
    case "PVP_COMBAT_BURST":
    case "PVP_UNIT_HIT":
    case "COMBAT_BURST":
    case "BARB_UNIT_HIT":
    case "PLAYER_UNIT_HIT":
    case "BARB_UNIT_KILLED":
      return 0;
    default:
      return 1;
  }
}

export function isPublicChronicleWeight(weight: number): boolean {
  return weight >= PUBLIC_CHRONICLE_MIN_WEIGHT;
}

export function generateHeadline(
  event: SimEvent,
  ctx: ChronicleContext,
): { headline: string; body: string } | null {
  switch (event.type) {
    case "GROUP_DEFEATED": {
      if (event.winnerGroupId !== "player" || !event.profileId) return null;
      const captain = ctx.captainNames.get(event.profileId) ?? "Un capitán";
      const pos = ctx.groupPositions.get(event.loserGroupId);
      const barbName = ctx.groupNames.get(event.loserGroupId) ?? "banda hostil";
      const coords = pos
        ? `cerca de (${Math.round(pos.x)},${Math.round(pos.y)})`
        : "en el valle";
      return {
        headline: `Capitán ${captain} destrozó la banda ${barbName} ${coords}`,
        body: `${survivorCount(event.survivorCount)} supervivientes.`,
      };
    }
    case "SEASON_CHANGED":
      return {
        headline: `La estación cambia a ${event.season}`,
        body: `Fase ${event.phase} del ciclo anual.`,
      };
    case "CITY_FOUNDED":
      return {
        headline: `Nueva ciudad: ${event.name}`,
        body: `${event.botProfile} funda asentamiento en (${Math.round(event.x)},${Math.round(event.y)}).`,
      };
    case "BARB_ATTACKS_CITY":
      return {
        headline: event.outcome === "WIN"
          ? `${event.campName} saqueó ${event.cityName}`
          : `La ciudad ${event.cityName} resistió el asalto de ${event.campName}`,
        body: event.outcome === "WIN" ? "Las defensas cayeron." : "Los muros aguantaron.",
      };
    case "CITY_ATTACKED":
      return {
        headline: event.outcome === "WIN"
          ? `${event.attackerName} conquistó ${event.defenderName}`
          : `${event.defenderName} repelió a ${event.attackerName}`,
        body: "Conflicto entre ciudades del valle.",
      };
    case "GROUP_ENGAGED":
      return {
        headline: `${event.nameA} choca con ${event.nameB}`,
        body: "Dos bandas entran en combate.",
      };
    case "CAMP_DEFEATED":
      return {
        headline: `Campamento ${event.name} destruido`,
        body: `Caída ante ${event.byId}.`,
      };
    case "PVP_COMBAT_END": {
      if (event.reason !== "elimination" || !event.winnerProfileId || !event.loserProfileId) {
        return null;
      }
      const winner = ctx.captainNames.get(event.winnerProfileId) ?? "Un capitán";
      const loser = ctx.captainNames.get(event.loserProfileId) ?? "un rival";
      return {
        headline: `${winner} eliminó el batallón de ${loser}`,
        body: "Duelo PvP decisivo en el valle.",
      };
    }
    default:
      return null;
  }
}

function survivorCount(n: number): string {
  return n === 1 ? "1" : String(n);
}

export function filterChronicleEvents(events: SimEvent[]): SimEvent[] {
  return events.filter(ev => eventWeight(ev) > 0);
}

export async function recordWorldEvents(
  pool: pg.Pool,
  worldId: string,
  simTimeMs: number,
  tickSeq: number,
  events: SimEvent[],
  ctx: ChronicleContext,
): Promise<ChronicleEntry[]> {
  const entries: ChronicleEntry[] = [];

  for (const event of filterChronicleEvents(events)) {
    const weight = eventWeight(event);
    const actorProfileId =
      ("profileId" in event && event.profileId)
        ? event.profileId
        : (event.type === "PVP_COMBAT_END" && event.winnerProfileId)
          ? event.winnerProfileId
          : undefined;
    const headlineData = generateHeadline(event, ctx);

    const { rows: eventRows } = await pool.query<{ id: string }>(
      `INSERT INTO world_events
         (world_id, sim_time_ms, tick_seq, event_type, weight, payload, actor_profile_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING id`,
      [
        worldId,
        simTimeMs,
        tickSeq,
        event.type,
        weight,
        JSON.stringify(event),
        actorProfileId ?? null,
      ],
    );
    const eventId = eventRows[0]!.id;

    if (!headlineData) continue;

    const isPublic = isPublicChronicleWeight(weight);
    const { rows: chronicleRows } = await pool.query<{ id: string }>(
      `INSERT INTO world_chronicle
         (world_id, event_id, headline, body, weight, is_public)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [worldId, eventId, headlineData.headline, headlineData.body, weight, isPublic],
    );

    if (actorProfileId) {
      await pool.query(
        `INSERT INTO player_chronicle (profile_id, event_id, headline, body)
         VALUES ($1, $2, $3, $4)`,
        [actorProfileId, eventId, headlineData.headline, headlineData.body],
      );
    }

    entries.push({
      id: chronicleRows[0]!.id,
      headline: headlineData.headline,
      body: headlineData.body,
      weight,
      isPublic,
      simTimeMs,
      eventType: event.type,
      actorProfileId,
    });
  }

  return entries;
}

export async function recordPlayerChronicleEntry(
  pool: pg.Pool,
  profileId: string,
  headline: string,
  body: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO player_chronicle (profile_id, headline, body)
     VALUES ($1, $2, $3)`,
    [profileId, headline, body],
  );
}

export async function fetchPublicChronicle(
  pool: pg.Pool,
  worldId: string,
  limit: number,
  after?: string,
): Promise<Array<{
  id: string;
  headline: string;
  body: string;
  weight: number;
  createdAt: string;
}>> {
  const params: unknown[] = [worldId, limit];
  let afterClause = "";
  if (after) {
    afterClause = "AND created_at < (SELECT created_at FROM world_chronicle WHERE id = $3::uuid)";
    params.push(after);
  }

  const { rows } = await pool.query<{
    id: string;
    headline: string;
    body: string;
    weight: number;
    created_at: Date;
  }>(
    `SELECT id, headline, body, weight, created_at
     FROM world_chronicle
     WHERE world_id = $1 AND is_public = true ${afterClause}
     ORDER BY created_at DESC
     LIMIT $2`,
    params,
  );

  return rows.map(r => ({
    id: r.id,
    headline: r.headline,
    body: r.body,
    weight: r.weight,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function fetchPlayerChronicle(
  pool: pg.Pool,
  profileId: string,
  limit: number,
  after?: string,
): Promise<Array<{
  id: string;
  headline: string;
  body: string;
  createdAt: string;
}>> {
  const params: unknown[] = [profileId, limit];
  let afterClause = "";
  if (after) {
    afterClause = "AND created_at < (SELECT created_at FROM player_chronicle WHERE id = $3::uuid)";
    params.push(after);
  }

  const { rows } = await pool.query<{
    id: string;
    headline: string;
    body: string;
    created_at: Date;
  }>(
    `SELECT id, headline, body, created_at
     FROM player_chronicle
     WHERE profile_id = $1 ${afterClause}
     ORDER BY created_at DESC
     LIMIT $2`,
    params,
  );

  return rows.map(r => ({
    id: r.id,
    headline: r.headline,
    body: r.body,
    createdAt: r.created_at.toISOString(),
  }));
}

export function chronicleEntriesForClient(
  entries: ChronicleEntry[],
  squadX: number | null,
  squadY: number | null,
  aoiRadius = 65,
): ChronicleEntry[] {
  if (squadX == null || squadY == null) {
    return entries.filter(e => e.weight >= 4);
  }
  return entries.filter(e => e.weight >= 4);
}
