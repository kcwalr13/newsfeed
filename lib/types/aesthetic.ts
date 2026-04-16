// Shared TypeScript types for the Phase 2 Latent Aesthetic Space feature.

/**
 * Named-field representation of a six-dimension aesthetic score vector.
 * Canonical index order: [contemplative, concrete, personal, playful, specialist, emotional]
 * All values are in the range 1.0–5.0.
 */
export interface AestheticScoreVector {
  contemplative: number;  // index 0 — 1=propulsive, 5=contemplative
  concrete:      number;  // index 1 — 1=concrete,   5=abstract
  personal:      number;  // index 2 — 1=personal,   5=universal
  playful:       number;  // index 3 — 1=playful,    5=serious
  specialist:    number;  // index 4 — 1=generalist, 5=specialist
  emotional:     number;  // index 5 — 1=neutral,    5=emotionally resonant
}

/**
 * A user's stored aesthetic profile: a centroid in the six-dimension aesthetic
 * space, maintained via EMA across qualifying feedback events.
 */
export interface AestheticProfile {
  user_id:        string | null;  // null for anonymous (device-only) sessions
  device_id:      string;         // always present; matches dd_device_id cookie value
  centroid:       AestheticScoreVector;
  feedback_count: number;         // total qualifying feedback events incorporated
  updated_at:     string;         // ISO-8601 timestamp of last centroid update
}
