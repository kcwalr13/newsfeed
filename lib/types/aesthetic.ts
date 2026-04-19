// Shared TypeScript types for the Phase 2 Latent Aesthetic Space feature (extended Phase 3).

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
  // Phase 3 additions:
  /** Rolling 21-day short-term centroid. Null until the first qualifying recompute. */
  short_term_centroid:       AestheticScoreVector | null;
  /** Number of qualifying feedback events in the current 21-day window. */
  short_term_feedback_count: number;
  /** ISO-8601 timestamp of the oldest qualifying event in the current window. Null if count < 3. */
  short_term_window_start:   string | null;
  /** True when the cosine distance between short-term and long-term centroids exceeds DRIFT_THRESHOLD. */
  is_drifting:               boolean;
  /** ISO-8601 timestamp when the current drift period began. Null when not drifting. */
  drift_detected_at:         string | null;
  // Phase 4 additions:
  /** Computed receptivity score in [0.0, 1.0]. Null until first feedback event. */
  receptivity_score:         number | null;
  /** Exploration budget derived from receptivity_score. Defaults to 4 (EXPLORATION_BASELINE). */
  exploration_budget:        number;
}
