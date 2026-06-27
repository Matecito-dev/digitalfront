import type { RNG } from "../sim/rng.js";
import { randChoice, randInt } from "../sim/rng.js";
import type { BarbarianArchetype } from "../sim/worldState.js";

const NAME_FIRST = [
  "Mateo", "Lucas", "Santiago", "Diego", "Nicolás", "Tomás", "Benjamín", "Joaquín",
  "Bruno", "Martín", "Lautaro", "Facundo", "Gonzalo", "Javier", "Ricardo", "Álvaro",
  "Ignacio", "Pedro", "Marcos", "Emilio", "Héctor", "Ramiro", "César", "Andrés",
  "Borja", "Iván", "Leandro", "Óscar", "Pablo", "Raúl",
];

const NAME_LAST = [
  "Rodríguez", "García", "Martínez", "López", "González", "Fernández", "Pérez",
  "Sánchez", "Romero", "Díaz", "Torres", "Ruiz", "Herrera", "Vega", "Morales",
  "Castillo", "Ortiz", "Silva", "Ríos", "Castro", "Mendoza", "Vargas", "Suárez",
];

const EPITHETS = [
  "el Despiadado", "de la Steppe", "Ojo de Halcón", "el Feroz", "Sin Miedo",
  "el Rápido", "de Hierro", "la Sombra", "el Salvaje", "el Implacable",
  "de las Llanuras", "el Silencioso", "el Temible", "de Sangre Fría",
];

const GROUP_PREFIX: Record<BarbarianArchetype, string[]> = {
  RAIDERS:   ["Horda", "Banda", "Compañía", "Cuadrilla"],
  HUNTERS:   ["Patrulla", "Manada", "Rastro", "Emboscada"],
  MARAUDERS: ["Horda", "Cuadrilla", "Legión", "Banda"],
  WARHOST:   ["Hueste", "Ejército", "Legión", "Falange"],
  NOMADS:    ["Caravana", "Tribu", "Clan", "Ruta"],
};

const GROUP_SUFFIX: Record<BarbarianArchetype, string[]> = {
  RAIDERS:   ["del Cuervo", "de Hierro", "del Trueno", "del Fuego"],
  HUNTERS:   ["del Bosque", "del Lobo", "del Águila", "de la Niebla"],
  MARAUDERS: ["Oscura", "del Cráneo", "de la Noche", "Sangrienta"],
  WARHOST:   ["de Guerra", "del Martillo", "de Acero", "Invencible"],
  NOMADS:    ["del Viento", "de la Arena", "Errante", "del Sol"],
};

export function generateUniqueBarbarianName(used: Set<string>, rng: RNG, fallbackId?: string): string {
  for (let i = 0; i < 50; i++) {
    const useEpithet = rng() < 0.35;
    const name = useEpithet
      ? `${randChoice(rng, NAME_FIRST)} ${randChoice(rng, EPITHETS)}`
      : `${randChoice(rng, NAME_FIRST)} ${randChoice(rng, NAME_LAST)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `Guerrero-${fallbackId ?? randInt(rng, 99999)}`;
  used.add(fallback);
  return fallback;
}

export function generateGroupName(archetype: BarbarianArchetype, rng: RNG): string {
  const pre = GROUP_PREFIX[archetype] ?? GROUP_PREFIX.RAIDERS;
  const suf = GROUP_SUFFIX[archetype] ?? GROUP_SUFFIX.RAIDERS;
  return `${randChoice(rng, pre)} ${randChoice(rng, suf)}`;
}
