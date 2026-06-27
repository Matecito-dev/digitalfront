/** Combat intensity thresholds and frenzy tuning. */

export const COMBAT_INTENSITY_MAX = 100;
export const INTENSITY_BUILDING_MIN = 25;
export const INTENSITY_PEAK_MIN = 50;
export const INTENSITY_COOLDOWN_MAX = 24;
/** Intensity gained per point of damage dealt or received. */
export const INTENSITY_PER_DAMAGE = 1.5;
/** Decay per sim tick (50 ms) while out of combat. */
export const INTENSITY_DECAY_PER_TICK = 2.5;
/** Cooldown multiplier when intensity exceeds peak threshold (−10%). */
export const FRENZY_COOLDOWN_MULT = 0.9;
