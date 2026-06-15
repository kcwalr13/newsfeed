// Content-format resolution for the issue mix guarantee (R5-D).
//
// Like categoryForArticle (P3-B2 decision), format is resolved ON READ from the
// article's fields + source rather than persisted onto every Article — so it
// works uniformly for in-memory candidates, stored batches, and historical
// batches with no pipeline re-run. The one exception is `place`: a whole-site
// "place to explore" (D3) has no derivable signal, so it is set explicitly at
// assembly and persisted; `formatForArticle` honours an explicit value first.

import type { Article, ContentFormat } from '@/lib/types/article';
import { categoryForArticle } from '@/lib/pipeline/sourceCategory';
import { LONGREAD_MIN_MINUTES } from '@/lib/config/feed';

/** Bare host without protocol / leading "www." (for source allowlist keys). */
function hostKey(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).host.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Image-forward sources beyond the art/design categories (which are caught by
 * category). Keyed by source name and homepage host so either field matching is
 * enough.
 */
const VISUAL_NAMES = new Set(['the public domain review']);
const VISUAL_HOSTS = new Set(['publicdomainreview.org']);

/**
 * Link-roundup / curio ("potpourri") sources. Tedium is the fixed one; the rest
 * are Small-Web curio sites that arrive via discovery. Kyle can extend this list.
 */
const POTPOURRI_NAMES = new Set(['tedium', 'cool tools', 'recomendo', 'web curios', 'webcurios']);
const POTPOURRI_HOSTS = new Set(['tedium.co', 'kk.org', 'ooh.directory']);

function nameKey(a: Article): string {
  return (a.sourceName ?? '').trim().toLowerCase();
}

function isVisualSource(a: Article): boolean {
  const cat = categoryForArticle(a);
  if (cat === 'art' || cat === 'design') return true;
  if (VISUAL_NAMES.has(nameKey(a))) return true;
  const h = hostKey(a.sourceUrl);
  return h != null && VISUAL_HOSTS.has(h);
}

function isPotpourriSource(a: Article): boolean {
  if (POTPOURRI_NAMES.has(nameKey(a))) return true;
  const h = hostKey(a.sourceUrl);
  return h != null && POTPOURRI_HOSTS.has(h);
}

/**
 * Derives a content-format from the article's fields + source. Returns undefined
 * when there's no signal (no body, no readTime, unknown source) — such a piece
 * counts toward none of the mix floors but isn't a longread either. `place` is
 * never derived (it's explicit only).
 */
function deriveContentFormat(a: Article): ContentFormat | undefined {
  // Source-based formats take precedence over readTime: a short Colossal post is
  // still `visual`, a Tedium roundup is still `potpourri`.
  if (isVisualSource(a)) return 'visual';
  if (isPotpourriSource(a)) return 'potpourri';

  const rt = a.readTime;
  if (rt != null && rt >= LONGREAD_MIN_MINUTES) return 'longread';
  if ((rt != null && rt > 0) || (a.bodyText != null && a.bodyText.trim().length > 0)) {
    return 'short';
  }
  return undefined;
}

/**
 * Resolves an article's content-format: an explicit value (a `place` item, or a
 * format persisted at assembly) wins; otherwise it's derived on read.
 */
export function formatForArticle(a: Article): ContentFormat | undefined {
  return a.format ?? deriveContentFormat(a);
}
