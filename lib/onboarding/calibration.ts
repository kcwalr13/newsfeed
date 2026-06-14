// Cold-start calibration set selection (P3-E1). Picks ~16 deliberately
// contrasting sample pieces — spanning editorial categories AND tonal poles —
// so a few like/pass choices on day one can seed the taste model past its
// minimum-signal thresholds (P3-E3). Preferred source: the latest assembled
// batch (real articles that already carry aesthetic scores, so feedback on them
// populates the aesthetic EMA); a committed seed file is the fallback.

import type { Article } from '@/lib/types/article';
import type { AestheticScoreVector } from '@/lib/types/aesthetic';
import { categoryForArticle } from '@/lib/pipeline/sourceCategory';
import { vectorToArray } from '@/lib/config/aesthetic';

/** A calibration card shown in the first-run flow. */
export interface CalibrationPiece {
  /** Real batch article id (so feedback routes through the normal path), or a
   *  seed id when drawn from the fallback. */
  id: string;
  title: string;
  /** Short dek/excerpt. */
  dek: string;
  /** Human-readable source name. */
  source: string;
  /** Editorial category, or 'eclectic' when unknown (discovery pieces). */
  category: string;
}

type CalibratableArticle = Pick<
  Article,
  'id' | 'title' | 'description' | 'sourceName' | 'sourceUrl'
>;

/** Tonal pronouncedness: total distance of the 6 aesthetic dims from the neutral
 *  midpoint (3). Higher = a more tonally distinctive piece → better contrast. */
function tonalExtremity(v: AestheticScoreVector | undefined): number {
  if (!v) return 0;
  return vectorToArray(v).reduce((sum, x) => sum + Math.abs(x - 3), 0);
}

/**
 * Selects up to `size` calibration pieces. Buckets the articles by category,
 * orders each bucket by tonal extremity (most distinctive first), then
 * round-robins across categories so the set spans many domains and leans toward
 * tonally pronounced pieces — maximizing the contrast the first-run flow shows.
 */
export function selectCalibrationSet(
  articles: CalibratableArticle[],
  scores: Map<string, AestheticScoreVector>,
  size: number
): CalibrationPiece[] {
  const buckets = new Map<string, CalibratableArticle[]>();
  for (const a of articles) {
    const cat = categoryForArticle(a) ?? 'eclectic';
    const arr = buckets.get(cat);
    if (arr) arr.push(a);
    else buckets.set(cat, [a]);
  }
  for (const arr of buckets.values()) {
    arr.sort((x, y) => tonalExtremity(scores.get(y.id)) - tonalExtremity(scores.get(x.id)));
  }

  const queues = [...buckets.values()];
  const picked: CalibratableArticle[] = [];
  let advanced = true;
  while (picked.length < size && advanced) {
    advanced = false;
    for (const q of queues) {
      if (picked.length >= size) break;
      const a = q.shift();
      if (a) {
        picked.push(a);
        advanced = true;
      }
    }
  }

  return picked.map((a) => ({
    id: a.id,
    title: a.title,
    dek: (a.description ?? '').trim().slice(0, 200),
    source: a.sourceName,
    category: categoryForArticle(a) ?? 'eclectic',
  }));
}
