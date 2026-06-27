/** Evita respawn inmediato de bandas tras derrotarlas (sensación de “reviven”). */
export const BARB_DEFEAT_COOLDOWN_MS = 90_000;

const cooldownUntilByProfile = new Map<string, number>();

export function markPlayerBarbDefeat(profileId: string, nowMs: number): void {
  if (!profileId) return;
  cooldownUntilByProfile.set(profileId, nowMs + BARB_DEFEAT_COOLDOWN_MS);
}

export function isPlayerOnBarbDefeatCooldown(profileId: string, nowMs: number): boolean {
  const until = cooldownUntilByProfile.get(profileId);
  if (until == null) return false;
  if (nowMs >= until) {
    cooldownUntilByProfile.delete(profileId);
    return false;
  }
  return true;
}

/** Solo para tests. */
export function clearBarbDefeatCooldowns(): void {
  cooldownUntilByProfile.clear();
}
