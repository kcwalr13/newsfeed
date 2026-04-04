import type { Article } from '@/lib/types/article';
import type { DbFeedbackRow } from '@/lib/db/feedback';

export const SUPPRESSION_MIN_EVENTS    = 5;
export const SUPPRESSION_DISLIKE_RATIO = 0.80;
export const EXPLORATION_SLOTS         = 3;
export const EXPLORATION_POSITIONS     = [2, 9, 16]; // 0-indexed
export const SOURCE_CONSECUTIVE_CAP    = 3;
export const MIN_FEED_ARTICLES         = 5;

interface SourceStats {
  slug: string;
  likes: number;
  dislikes: number;
  total: number;
  score: number;       // Wilson lower bound, or 0.5 if total === 0
  suppressed: boolean;
}

// Wilson score lower bound for a binomial proportion.
// Returns 0.5 when total === 0 (neutral, no feedback).
function wilsonLowerBound(likes: number, total: number): number {
  if (total === 0) return 0.5;
  const z = 1.96;
  const zz = z * z;
  const phat = likes / total;
  const numerator =
    phat + zz / (2 * total) -
    z * Math.sqrt((phat * (1 - phat) + zz / (4 * total)) / total);
  const denominator = 1 + zz / total;
  return numerator / denominator;
}

// Derives the source slug from a sourceName string, matching the makeId() logic in run.ts.
function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// Post-processing pass: enforces no more than `cap` consecutive articles from the same source.
// Does not drop articles. When the cap is reached, pulls the next article from a different
// source forward in the list; if none exists, accepts the violation rather than dropping.
function applyDiversityCap(articles: Article[], cap: number): Article[] {
  const pending = [...articles];
  const result: Article[] = [];
  let runSource: string | null = null;
  let runLength = 0;

  while (pending.length > 0) {
    let picked = 0;

    if (runLength >= cap) {
      // Must pick from a different source to break the run
      const altIdx = pending.findIndex(a => slugify(a.sourceName) !== runSource);
      if (altIdx !== -1) picked = altIdx;
      // If no alternative exists, fall through and pick index 0 (accept violation)
    }

    const article = pending.splice(picked, 1)[0];
    const slug = slugify(article.sourceName);
    if (slug === runSource) {
      runLength += 1;
    } else {
      runSource = slug;
      runLength = 1;
    }
    result.push(article);
  }

  return result;
}

export function rankFeed(
  articles: Article[],
  feedbackRows: DbFeedbackRow[]
): Article[] {
  // Step 1: Build articleId → sourceSlug map from batch
  const sourceSlugMap = new Map<string, string>();
  for (const article of articles) {
    sourceSlugMap.set(article.id, slugify(article.sourceName));
  }

  // Step 2: Aggregate feedback rows into per-source stats
  const sourceStatsRaw = new Map<string, { likes: number; dislikes: number; total: number }>();
  for (const row of feedbackRows) {
    const slug = sourceSlugMap.get(row.article_id);
    if (slug === undefined) continue; // feedback for article not in today's batch — skip
    if (!sourceStatsRaw.has(slug)) {
      sourceStatsRaw.set(slug, { likes: 0, dislikes: 0, total: 0 });
    }
    const stats = sourceStatsRaw.get(slug)!;
    if (row.value === 'like') {
      stats.likes += 1;
    } else {
      stats.dislikes += 1;
    }
    stats.total += 1;
  }

  // Step 3: Compute sourceScores for every unique source slug in the batch
  const allSlugs = new Set<string>();
  for (const article of articles) {
    allSlugs.add(slugify(article.sourceName));
  }

  const sourceScores = new Map<string, SourceStats>();
  for (const slug of allSlugs) {
    const raw = sourceStatsRaw.get(slug) ?? { likes: 0, dislikes: 0, total: 0 };
    const score = wilsonLowerBound(raw.likes, raw.total);
    const suppressed =
      raw.total >= SUPPRESSION_MIN_EVENTS &&
      raw.dislikes / raw.total >= SUPPRESSION_DISLIKE_RATIO;
    sourceScores.set(slug, { slug, ...raw, score, suppressed });
  }

  // Step 4: Sort non-suppressed articles by (score DESC, publishedAt DESC)
  const rankedCandidates = articles
    .filter(a => !sourceScores.get(slugify(a.sourceName))!.suppressed)
    .sort((a, b) => {
      const scoreA = sourceScores.get(slugify(a.sourceName))!.score;
      const scoreB = sourceScores.get(slugify(b.sourceName))!.score;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return b.publishedAt.localeCompare(a.publishedAt);
    });

  // Step 5: Identify exploration candidates: sources with zero feedback AND not suppressed.
  // Exploration only applies when the user has at least some feedback for today's batch;
  // with zero feedback there are no established preferences to diversify against.
  const explorationPool: Article[] = [];

  if (sourceStatsRaw.size > 0) {
    const explorationSlugs = new Set<string>();
    for (const slug of allSlugs) {
      const stats = sourceScores.get(slug)!;
      if (stats.total === 0 && !stats.suppressed) {
        explorationSlugs.add(slug);
      }
    }

    // Pick the first (highest-ranked) article per unseen source
    const explorationBySrc = new Map<string, Article>();
    for (const article of rankedCandidates) {
      const slug = slugify(article.sourceName);
      if (explorationSlugs.has(slug) && !explorationBySrc.has(slug)) {
        explorationBySrc.set(slug, article);
      }
    }

    // Randomly shuffle unseen source slugs and pick up to EXPLORATION_SLOTS
    const explorationSourceList = Array.from(explorationBySrc.keys());
    for (let i = explorationSourceList.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [explorationSourceList[i], explorationSourceList[j]] =
        [explorationSourceList[j], explorationSourceList[i]];
    }

    for (let i = 0; i < Math.min(EXPLORATION_SLOTS, explorationSourceList.length); i++) {
      explorationPool.push(explorationBySrc.get(explorationSourceList[i])!);
    }
  }

  // Step 6: All-sources-suppressed fallback: append least-disliked suppressed articles
  let ranked = [...rankedCandidates];
  if (ranked.length < MIN_FEED_ARTICLES) {
    const suppressedArticles = articles
      .filter(a => sourceScores.get(slugify(a.sourceName))!.suppressed)
      .sort((a, b) =>
        sourceScores.get(slugify(b.sourceName))!.score -
        sourceScores.get(slugify(a.sourceName))!.score
      );
    const needed = MIN_FEED_ARTICLES - ranked.length;
    ranked = [...ranked, ...suppressedArticles.slice(0, needed)];
  }

  // Step 7: Remove exploration articles from the ranked list (they are placed separately)
  const explorationIds = new Set(explorationPool.map(a => a.id));
  ranked = ranked.filter(a => !explorationIds.has(a.id));

  // Step 8: Insert exploration articles at EXPLORATION_POSITIONS (0-indexed, ascending)
  const output = [...ranked];
  const sortedPositions = [...EXPLORATION_POSITIONS].sort((a, b) => a - b);
  for (let i = 0; i < sortedPositions.length && i < explorationPool.length; i++) {
    const insertAt = Math.min(sortedPositions[i], output.length);
    output.splice(insertAt, 0, explorationPool[i]);
  }

  // Step 9: Apply source diversity cap
  return applyDiversityCap(output, SOURCE_CONSECUTIVE_CAP);
}
