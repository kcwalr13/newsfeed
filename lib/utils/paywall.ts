// Per-item paywall / teaser detection (R5-B1). Substack paid posts, member-only
// blogs, etc. ship only a teaser in their RSS (and on the page), so the reader
// would otherwise render a misleading 1–2-paragraph stub. This flags such items
// so the pipeline can drop the teaser (retry the full page) and, if it's still
// paywalled after backfill, exclude it from the issue.
//
// Phrase-match is the PRIMARY signal, anchored to short standalone lines (the
// same idiom as the share-bar heuristic in bodyClean.ts): a paywall notice is a
// short CTA line, not a clause buried inside real prose. Length is only a weak
// SECONDARY signal — deliberately NOT AESTHETIC_BODY_MIN_CHARS (300): a
// legitimately short *free* visual post (workstream D) is not paywalled.
//
// Detection is strictly PER-ITEM, never per-source — a Substack author's free
// posts must not be suppressed alongside their paid ones.

/**
 * Paywall-specific phrases. Chosen to be unambiguous CTAs/notices that a free
 * article would not carry — NOT generic newsletter prompts ("subscribe to our
 * newsletter") or free-truncation markers ("read more on our site"), which
 * appear on free pages and must not trip the filter.
 */
const PAYWALL_PHRASES: RegExp[] = [
  /\bsubscribe to (read|continue|keep reading)\b/,
  /\bsubscribe to (get|unlock|see) (the|this|full|all)\b/,
  /\bthis (post|article|story|content) is for (paid|paying|premium)\b/,
  /\b(paid|paying|premium) (subscribers?|members?) only\b/,
  /\b(subscribers?|members?)[- ]only\b/,
  /\bbecome a (paid )?(member|subscriber|patron)\b/,
  /\bto (continue|keep) reading,?\s*(subscribe|sign in|sign up|log in|become)\b/,
  /\b(subscribe|sign in|log in|upgrade) to (continue|keep) reading\b/,
  /\bunlock (the|this|full|unlimited|every|all)\b/,
  /\bupgrade to (paid|premium|a paid)\b/,
  /\bthis is a (free )?preview\b/,
  /\bread the full (post|article|story) (on|at|with)\b/,
  /\balready a (paid )?(subscriber|member)\?/,
];

/**
 * Secondary length floor. Far below AESTHETIC_BODY_MIN_CHARS (300) so free short
 * posts aren't swept up: only a body shorter than this AND carrying a softer
 * subscribe cue is treated as a teaser.
 */
export const PAYWALL_MIN_CONTENT_CHARS = 220;

/** Longest line still treated as a standalone CTA/notice (not prose). */
const PAYWALL_LINE_MAX = 160;

/** Softer cue used only to corroborate the secondary length signal. */
const SOFT_SUBSCRIBE_CUE = /\b(subscribe|subscriber|paywall|paid post|membership)\b/;

/**
 * Returns true when bodyText looks like a paywalled teaser rather than the full
 * article. Phrase-match (primary) is anchored to short lines; a short-body +
 * soft-cue combination (secondary) is a weak backstop.
 */
export function detectPaywall(bodyText: string | undefined | null): boolean {
  if (!bodyText) return false;
  const text = bodyText.trim();
  if (!text) return false;

  // Primary: a short standalone line matching a paywall-specific phrase.
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.length > PAYWALL_LINE_MAX) continue; // real prose — skip
    const low = line.toLowerCase();
    if (PAYWALL_PHRASES.some((re) => re.test(low))) return true;
  }

  // Secondary (weak): a very short body that also carries a subscribe cue.
  if (text.length < PAYWALL_MIN_CONTENT_CHARS && SOFT_SUBSCRIBE_CUE.test(text.toLowerCase())) {
    return true;
  }

  return false;
}
