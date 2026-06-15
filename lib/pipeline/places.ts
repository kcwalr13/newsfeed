// "A place to explore" sourcing (R5-D3): a curated, committed list of whole
// sites to wander — Small-Web directories, search engines for the indie web,
// and a few standout digital gardens. A place item is injected on a determin-
// istic cadence (not every issue) so it stays a special surprise.

import path from 'path';
import fs from 'fs';

/** A hand-picked site to get lost in. */
export interface Place {
  /** Display name (also the card title). */
  name: string;
  /** Homepage URL — the Explore CTA links straight here. */
  url: string;
  /** Bespoke, inviting curator note (used verbatim as the card blurb). */
  note: string;
}

const PLACES_PATH = path.resolve(process.cwd(), 'data', 'places.json');

/**
 * Feature a place every Nth issue (keyed on the batch date) so it stays a
 * ~1-in-N surprise rather than a fixture. Kyle can tune this / curate the list.
 */
export const PLACE_ISSUE_INTERVAL = 3;

let cache: Place[] | null = null;

/** Loads (and memoizes) the curated places list; [] if the file is absent/bad. */
export function loadPlaces(): Place[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(PLACES_PATH, 'utf-8')) as unknown;
    cache = Array.isArray(parsed)
      ? (parsed as Place[]).filter(
          (p) =>
            p &&
            typeof p.name === 'string' &&
            typeof p.url === 'string' &&
            typeof p.note === 'string'
        )
      : [];
  } catch {
    cache = []; // no places file → no place items (non-fatal)
  }
  return cache;
}

/** Whole days since the Unix epoch for a YYYY-MM-DD batch date (UTC). */
function epochDay(batchDate: string): number | null {
  const ms = Date.parse(`${batchDate}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 86_400_000);
}

/**
 * Deterministically selects the place to feature for `batchDate`, or null on
 * the issues that get none. Cadence + rotation derive from the date, so a
 * re-run for the same day picks the same place (no Math.random — re-run safe).
 */
export function selectPlaceForBatch(batchDate: string): Place | null {
  const places = loadPlaces();
  if (places.length === 0) return null;
  const day = epochDay(batchDate);
  if (day === null) return null;
  if (day % PLACE_ISSUE_INTERVAL !== 0) return null; // not a place issue
  const idx = Math.floor(day / PLACE_ISSUE_INTERVAL) % places.length;
  return places[idx];
}

/** Test/diagnostic hook: clears the memoized list so the next call re-reads disk. */
export function resetPlacesCache(): void {
  cache = null;
}
