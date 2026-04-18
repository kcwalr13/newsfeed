// TypeScript types for the Phase 3 concept graph tables.

/** One concept node in the user's concept graph. */
export interface UserConcept {
  id:               number;
  user_id:          string | null;   // null for anonymous (device-only) sessions
  device_id:        string;
  label:            string;          // 2–5 word concept label, e.g. "urban heat islands"
  extraction_count: number;          // how many liked articles contributed this concept
  engagement_weight: number;         // cumulative engagement weight across all extractions
  last_seen_at:     string;          // ISO-8601
  created_at:       string;          // ISO-8601
}

/** One undirected co-occurrence edge in the user's concept graph. */
export interface UserConceptEdge {
  id:                  number;
  user_id:             string | null;
  device_id:           string;
  concept_a:           string;       // alphabetically <= concept_b (always)
  concept_b:           string;
  co_occurrence_count: number;
  last_seen_at:        string;       // ISO-8601
}
