/** Synchronous mobile detection — mirrors getIsMobileNow from etheria frontend. */
export function getIsMobileNow(): boolean {
  if (typeof navigator === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const narrow = window.innerWidth < 768;
  return coarse || narrow;
}
