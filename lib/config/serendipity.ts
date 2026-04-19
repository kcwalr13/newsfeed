// All Phase 4 serendipity constants: exploration budget, slot allocation, and receptivity weights.

export const EXPLORATION_BASELINE = 4;
export const EXPLORATION_FLOOR    = 2;
export const EXPLORATION_CEILING  = 6;
export const WILDCARD_SLOT_COUNT  = 1;

export const SLOT_ALLOCATION: Record<number, {
  semanticStretch: number;
  blindSpotProbe:  number;
  wildcard:        number;
}> = {
  2: { semanticStretch: 1, blindSpotProbe: 0, wildcard: 1 },
  3: { semanticStretch: 2, blindSpotProbe: 0, wildcard: 1 },
  4: { semanticStretch: 2, blindSpotProbe: 1, wildcard: 1 },
  5: { semanticStretch: 3, blindSpotProbe: 1, wildcard: 1 },
  6: { semanticStretch: 3, blindSpotProbe: 2, wildcard: 1 },
};

// Receptivity thresholds (ascending max boundary, inclusive)
export const RECEPTIVITY_THRESHOLDS: ReadonlyArray<{
  max: number;
  budget: number;
}> = [
  { max: 0.30, budget: 2 },
  { max: 0.55, budget: 3 },
  { max: 0.70, budget: 4 },
  { max: 0.85, budget: 5 },
  { max: 1.00, budget: 6 },
];

export const RECEPTIVITY_WEIGHT_DIVERSITY        = 0.40;
export const RECEPTIVITY_WEIGHT_PROBE_ACCEPTANCE = 0.35;
export const RECEPTIVITY_WEIGHT_DWELL_RATIO      = 0.25;
export const DWELL_RATIO_CAP                     = 1.5;

export const RECEPTIVITY_DIVERSITY_MIN_LIKES  = 3;
export const RECEPTIVITY_PROBE_MIN_SHOWN      = 3;
export const RECEPTIVITY_DWELL_MIN_POINTS     = 3;

// Startup assertion: every budget level in [FLOOR, CEILING] must have an allocation.
for (let b = EXPLORATION_FLOOR; b <= EXPLORATION_CEILING; b++) {
  if (!(b in SLOT_ALLOCATION)) {
    throw new Error(`serendipity.ts: SLOT_ALLOCATION missing entry for budget=${b}`);
  }
}
