/**
 * Curator rationale generation.
 *
 * For each exploration-slot article (semantic_stretch, blind_spot_probe, wildcard),
 * calls Claude Haiku to produce a one-sentence "why this" rationale.
 *
 * Rationales are stored on article.rationale and persisted back to the batch
 * so subsequent requests skip LLM calls.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Article } from '@/lib/types/article';
import { appendLog } from '@/lib/pipeline/storage';

// Lazily initialised so the module can be imported in environments without the key set.
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

type SlotType = 'semantic_stretch' | 'blind_spot_probe' | 'wildcard';

/**
 * Returns a one-sentence prompt asking Claude Haiku to explain why this article
 * belongs in the given exploration slot.
 */
function buildPrompt(article: Article, slotType: SlotType): string {
  const title = article.title;
  const source = article.sourceName;
  const excerpt = article.description
    ? ` It begins: "${article.description.slice(0, 120)}"`
    : '';

  switch (slotType) {
    case 'semantic_stretch':
      return (
        `Write one sentence under 18 words that explains why "${title}" (${source}) would ` +
        `intellectually stretch a curious reader beyond their usual range.${excerpt} ` +
        `Start with a lowercase verb (e.g. "bridges", "draws", "connects"). No quotes, no period at end.`
      );
    case 'blind_spot_probe':
      return (
        `Write one sentence under 18 words that explains why "${title}" (${source}) addresses ` +
        `an overlooked angle or perspective.${excerpt} ` +
        `Start with a lowercase verb (e.g. "surfaces", "reframes", "challenges"). No quotes, no period at end.`
      );
    case 'wildcard':
      return (
        `Write one sentence under 18 words that explains the surprising or unexpected value of ` +
        `"${title}" (${source}).${excerpt} ` +
        `Start with a lowercase verb (e.g. "arrives", "reveals", "offers"). No quotes, no period at end.`
      );
  }
}

/**
 * Generates a rationale for a single slotted article.
 * Returns null if the API key is absent or the call fails.
 */
export async function generateRationale(
  article: Article,
  slotType: SlotType
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const prompt = buildPrompt(article, slotType);
    const msg = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = msg.content[0];
    if (!block || block.type !== 'text') return null;
    // Trim punctuation artifacts and normalise whitespace
    return block.text.replace(/\.$/, '').replace(/\s+/g, ' ').trim() || null;
  } catch (err) {
    appendLog(
      `[rationale] Failed for article ${article.id} (${slotType}): ` +
        (err instanceof Error ? err.message : String(err))
    );
    return null;
  }
}

/**
 * Generates rationales for all exploration-slot articles in the ranked feed
 * that do not yet have a rationale stored.
 *
 * Mutates article.rationale in-place.
 * Returns the number of rationales generated.
 */
export async function generateMissingRationales(articles: Article[]): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) return 0;

  const slotted = articles.filter(
    (a) =>
      a.explorationSlotType != null &&
      (a.explorationSlotType === 'semantic_stretch' ||
        a.explorationSlotType === 'blind_spot_probe' ||
        a.explorationSlotType === 'wildcard') &&
      !a.rationale
  );

  if (slotted.length === 0) return 0;

  // Run in parallel — Haiku is fast and the count is small (2–4 articles)
  const results = await Promise.allSettled(
    slotted.map(async (article) => {
      const slotType = article.explorationSlotType as SlotType;
      const rationale = await generateRationale(article, slotType);
      if (rationale) {
        article.rationale = rationale;
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
    appendLog(`[rationale] Generated ${count} rationale(s) for slotted articles`);
  }

  return count;
}
