/** Marca del juego y catálogo de mundos demo — fuente de verdad (servidor / tests). */
export const BRAND = {
  gameTitle: "Digital Front",
  gameSubtitle: "Guerra en tiempo real",
  defaultWorldSeed: "valle-bruma",
  appId: "com.digitalfront.game",
  /** seed → nombre visible en UI */
  worlds: {
    "valle-bruma": "Valle de Bruma",
  } as Record<string, string>,
} as const;

export function worldDisplayName(seed: string): string {
  return BRAND.worlds[seed as keyof typeof BRAND.worlds] ?? seed;
}
