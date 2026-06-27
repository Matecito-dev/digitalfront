export type WsPlayerOrder =
  | "move"
  | "hold"
  | "attack"
  | "attack_pvp"
  | "fire_hold"
  | "stealth"
  | "attack_move";

export interface ParsedPlayerOrder {
  order: WsPlayerOrder;
  x: number;
  y: number;
  groupId: string | null;
  targetProfileId: string | null;
  appendWaypoint: boolean;
}

export interface WorldBounds {
  cols: number;
  rows: number;
}

const VALID_ORDERS = new Set<WsPlayerOrder>([
  "move", "hold", "attack", "attack_pvp", "fire_hold", "stealth", "attack_move",
]);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clampCoord(v: number, max: number): number {
  return Math.max(0, Math.min(max - 0.001, v));
}

export function isCoordInBounds(x: number, y: number, bounds: WorldBounds): boolean {
  return x >= 0 && y >= 0 && x < bounds.cols && y < bounds.rows;
}

export function parsePlayerOrderMessage(
  raw: unknown,
  bounds: WorldBounds,
): ParsedPlayerOrder | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;
  if (msg.type !== "order") return null;

  const order = msg.order;
  if (typeof order !== "string" || !VALID_ORDERS.has(order as WsPlayerOrder)) return null;

  let x = isFiniteNumber(msg.x) ? msg.x : 0;
  let y = isFiniteNumber(msg.y) ? msg.y : 0;
  x = clampCoord(x, bounds.cols);
  y = clampCoord(y, bounds.rows);

  let groupId: string | null = null;
  if (order === "attack") {
    if (typeof msg.groupId === "string" && msg.groupId.length > 0) {
      groupId = msg.groupId;
    } else {
      return null;
    }
  }

  let targetProfileId: string | null = null;
  if (order === "attack_pvp") {
    if (typeof msg.targetProfileId === "string" && msg.targetProfileId.length > 0) {
      targetProfileId = msg.targetProfileId;
    } else {
      return null;
    }
  }

  const appendWaypoint = msg.appendWaypoint === true;

  if (!isCoordInBounds(x, y, bounds) && order !== "hold" && order !== "fire_hold") {
    return null;
  }

  return {
    order: order as WsPlayerOrder,
    x,
    y,
    groupId,
    targetProfileId,
    appendWaypoint,
  };
}

export function parseCampActionMessage(
  raw: unknown,
): { action: string; outpostId: string; soldiers?: number; snipers?: number; instantHeal?: boolean } | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;
  if (msg.type !== "camp_action") return null;
  if (typeof msg.action !== "string" || typeof msg.outpostId !== "string") return null;
  const soldiers = typeof msg.soldiers === "number" ? msg.soldiers : undefined;
  const snipers = typeof msg.snipers === "number" ? msg.snipers : undefined;
  const instantHeal = msg.instantHeal === true;
  return { action: msg.action, outpostId: msg.outpostId, soldiers, snipers, instantHeal };
}

export function parseSquadActionMessage(
  raw: unknown,
): { action: "unstuck" } | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;
  if (msg.type !== "squad_action") return null;
  if (msg.action === "unstuck") return { action: "unstuck" };
  return null;
}

export function parseChatSendMessage(
  raw: unknown,
): { channel: "global" | "sector"; text: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;
  if (msg.type !== "chat_send") return null;
  if (msg.channel !== "global" && msg.channel !== "sector") return null;
  if (typeof msg.text !== "string") return null;
  return { channel: msg.channel, text: msg.text };
}
