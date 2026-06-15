/**
 * Personalized curator note generation (R5-C).
 *
 * For each displayed article, calls Claude Haiku to produce a short, second-person
 * editorial note — "why YOU might love this and what taste it invites" — that
 * REPLACES the raw RSS summary as the card blurb. It is an invitation that sells
 * the detour, NOT a summary.
 *
 * The note is fed a compact taste digest (the reader's top concept labels, a
 * tone descriptor from their aesthetic centroid, and this piece's own aesthetic
 * vector) so it speaks to the actual reader. Notes are stored on
 * article.curatorNote and persisted back to the batch so subsequent loads skip
 * the LLM call.
 */

import type { Article } from '@/lib/types/article';
import type { AestheticScoreVector } from '@/lib/types/aesthetic';
import { UNTRUSTED_CONTENT_NOTICE, wrapUntrusted } from '@/lib/utils/promptSafety';
import { appendLog } from '@/lib/pipeline/storage';
import { getLlm, isLlmConfigured } from '@/lib/llm';

/** Compact, request-resolved sketch of the reader's taste (R5-C). */
export interface TasteDigest {
  /** The reader's top concept labels (getTopConceptNodes), strongest first. */
  topConcepts: string[];
  /** Long-term aesthetic centroid, or null for a cold-start reader. */
  centroid: AestheticScoreVector | null;
  /** Per-article aesthetic vectors, keyed by article id. */
  articleScores: Map<string, AestheticScoreVector>;
}

/**
 * Turns a 1–5 aesthetic vector into a short human tone descriptor (e.g.
 * "contemplative, abstract, emotionally resonant"). Only the clearly-leaning
 * dimensions contribute, so a neutral profile yields an empty string.
 */
function describeTone(v: AestheticScoreVector | null | undefined): string {
  if (!v) return '';
  const traits: string[] = [];
  const lean = (
    value: number,
    low: string,
    high: string,
    lo = 2.6,
    hi = 3.4
  ) => {
    if (value <= lo) traits.push(low);
    else if (value >= hi) traits.push(high);
  };
  // Axis polarity matches AestheticScoreVector's documented 1↔5 meanings.
  lean(v.contemplative, 'propulsive', 'contemplative');
  lean(v.concrete, 'concrete', 'abstract');
  lean(v.personal, 'intimate', 'wide-angle');
  lean(v.playful, 'playful and wry', 'serious');
  lean(v.specialist, 'accessible', 'specialist');
  lean(v.emotional, 'cool and analytical', 'emotionally resonant');
  return traits.join(', ');
}

const SYSTEM_PROMPT =
  'You are the curator of Tangent, a quiet daily reading companion. You write a ' +
  'short, personal note to ONE reader, addressing them as "you". Given a piece ' +
  'and a sketch of the reader\'s taste, write 1–2 sentences (at most ~32 words) ' +
  'that make the case for THIS detour: why this particular reader might love it, ' +
  'and what it invites or gently stretches in their taste. It is a warm, literate ' +
  'editorial invitation — NOT a summary. Never restate the title or describe the ' +
  'plot. No quotes, no emoji, no hashtags, no exclamation marks. ' +
  UNTRUSTED_CONTENT_NOTICE;

function buildUserPrompt(article: Article, digest: TasteDigest): string {
  const lines: string[] = ['Piece:', `Title: ${article.title}`, `Source: ${article.sourceName}`];
  if (article.description) {
    lines.push(`It opens: ${article.description.slice(0, 160)}`);
  }
  const pieceTone = describeTone(digest.articleScores.get(article.id));
  if (pieceTone) lines.push(`This piece reads as: ${pieceTone}`);

  lines.push('', 'The reader:');
  if (digest.topConcepts.length > 0) {
    lines.push(`Recent interests: ${digest.topConcepts.slice(0, 12).join(', ')}`);
  }
  const readerTone = describeTone(digest.centroid);
  if (readerTone) lines.push(`Their reading texture: ${readerTone}`);
  if (digest.topConcepts.length === 0 && !readerTone) {
    lines.push('(Still learning their taste — speak to the curious newcomer.)');
  }

  return wrapUntrusted(lines.join('\n'));
}

/**
 * Generates a curator note for a single article. Returns null if the API key is
 * absent or the call fails (caller leaves the blurb on the RSS description).
 */
export async function generateCuratorNote(
  article: Article,
  digest: TasteDigest
): Promise<string | null> {
  if (!isLlmConfigured()) return null;

  try {
    const raw = await getLlm().generateText({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(article, digest),
      maxTokens: 110,
    });

    // Strip wrapping quotes, normalise whitespace, clamp runaway output.
    const text = raw
      .replace(/\s+/g, ' ')
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .trim()
      .slice(0, 280);
    return text || null;
  } catch (err) {
    appendLog(
      `[curatorNote] Failed for article ${article.id}: ` +
        (err instanceof Error ? err.message : String(err))
    );
    return null;
  }
}

/**
 * Generates curator notes for every article in `articles` that doesn't already
 * have one. Mutates article.curatorNote in-place. Returns the count generated.
 *
 * Callers pass only the DISPLAYED slice (not the whole batch) so cost is bounded
 * to the issue size; already-noted articles (cache hits) are skipped.
 */
export async function generateMissingCuratorNotes(
  articles: Article[],
  digest: TasteDigest
): Promise<number> {
  if (!isLlmConfigured()) return 0;

  const pending = articles.filter((a) => !a.curatorNote);
  if (pending.length === 0) return 0;

  const results = await Promise.allSettled(
    pending.map(async (article) => {
      const note = await generateCuratorNote(article, digest);
      if (note) {
        article.curatorNote = note;
        return 1;
      }
      return 0;
    })
  );

  const count = results.reduce(
    (sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0),
    0
  );

  if (count > 0) {
    appendLog(`[curatorNote] Generated ${count} curator note(s)`);
  }

  return count;
}
