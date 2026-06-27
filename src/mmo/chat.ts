import { getPlayerCentroid } from "../sim/playerSquad.js";
import type { PlayerSquad, WorldState } from "../sim/worldState.js";
import { sectorIndex, MAP_SECTOR_COUNT } from "./spawn.js";

export type ChatChannel = "global" | "sector";

export interface ChatMessage {
  channel: ChatChannel;
  profileId: string;
  captainName: string;
  text: string;
  ts: number;
  sectorIndex?: number;
}

const GLOBAL_MAX = 100;
const SECTOR_MAX = 50;
const MAX_TEXT_LEN = 200;
const RATE_LIMIT_MS = 2000;

export class ChatService {
  private globalHistory: ChatMessage[] = [];
  private sectorHistory = new Map<number, ChatMessage[]>();
  private lastSendMs = new Map<string, number>();

  sanitize(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_TEXT_LEN) return null;
    return trimmed
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  getSquadSector(state: WorldState, squad: PlayerSquad | undefined): number {
    if (!squad || squad.wiped) return 0;
    const c = getPlayerCentroid(squad.units);
    const cols = state.terrain.cols;
    const rows = state.terrain.rows;
    if (!squad.units.some(u => u.hp > 0)) return 0;
    return sectorIndex(Math.floor(c.x), Math.floor(c.y), cols, rows);
  }

  trySend(
    state: WorldState,
    profileId: string,
    captainName: string,
    channel: ChatChannel,
    rawText: string,
  ): { ok: true; msg: ChatMessage } | { ok: false; reason: string } {
    const text = this.sanitize(rawText);
    if (!text) return { ok: false, reason: "invalid_text" };

    const now = Date.now();
    const last = this.lastSendMs.get(profileId) ?? 0;
    if (now - last < RATE_LIMIT_MS) return { ok: false, reason: "rate_limit" };

    const squad = state.playerSquads.get(profileId);
    const sector = this.getSquadSector(state, squad);

    const msg: ChatMessage = {
      channel,
      profileId,
      captainName,
      text,
      ts: now,
      ...(channel === "sector" ? { sectorIndex: sector } : {}),
    };

    this.lastSendMs.set(profileId, now);

    if (channel === "global") {
      this.globalHistory.push(msg);
      if (this.globalHistory.length > GLOBAL_MAX) {
        this.globalHistory.shift();
      }
    } else {
      const bucket = this.sectorHistory.get(sector) ?? [];
      bucket.push(msg);
      if (bucket.length > SECTOR_MAX) bucket.shift();
      this.sectorHistory.set(sector, bucket);
    }

    return { ok: true, msg };
  }

  getHistoryForClient(state: WorldState, profileId: string): ChatMessage[] {
    const squad = state.playerSquads.get(profileId);
    const sector = this.getSquadSector(state, squad);
    const sectorMsgs = this.sectorHistory.get(sector) ?? [];
    return [...this.globalHistory, ...sectorMsgs].sort((a, b) => a.ts - b.ts);
  }

  getRecipients(
    state: WorldState,
    msg: ChatMessage,
    authenticatedProfileIds: Iterable<string>,
  ): string[] {
    if (msg.channel === "global") {
      return [...authenticatedProfileIds];
    }
    const sector = msg.sectorIndex ?? 0;
    const out: string[] = [];
    for (const pid of authenticatedProfileIds) {
      const squad = state.playerSquads.get(pid);
      if (this.getSquadSector(state, squad) === sector) out.push(pid);
    }
    return out;
  }

  /** For tests — reset state. */
  clear(): void {
    this.globalHistory = [];
    this.sectorHistory.clear();
    this.lastSendMs.clear();
  }
}

export const chatService = new ChatService();

export function getAllSectorBuckets(): number {
  return MAP_SECTOR_COUNT;
}
