// SERVER-SIDE ONLY — never import in browser bundles.
//
// Pipeline-time taste context for the Round-7 discovery engine (R7-3): a compact
// sketch of Kyle's taste, resolved once per run, fed to the interestingness/taste
// judge (so it scores for FIT, not just generic quality) and to the LLM agentic
// stream (so its proposed themes lean toward what he likes).
//
// The daily cron carries no session, so identity is resolved from the most-recent
// feedback row (single-user app) — the same pattern blindSpotProber uses. Every
// read is best-effort: a cold-start reader (no feedback yet) or any DB error
// yields an empty context, and the judge/hunt simply fall back to general taste.

import type { AestheticScoreVector } from '@/lib/types/aesthetic';
import { getMostRecentFeedbackIdentity } from '@/lib/db/feedback';
import { getAestheticProfile } from '@/lib/db/aesthetics';
import { getTopConceptNodes } from '@/lib/db/concepts';
import { appendLog } from '@/lib/pipeline/storage';

/** Compact, pipeline-resolved sketch of Kyle's taste for the judge + hunt (R7-3). */
export interface TasteContext {
  /** Strongest concept labels (engagement-weighted), strongest first. */
  topConcepts: string[];
  /** Short human tone descriptor from the long-term centroid (e.g.
   *  "contemplative, abstract, emotionally resonant"); '' for a cold start. */
  toneDescriptor: string;
}

export const EMPTY_TASTE_CONTEXT: TasteContext = { topConcepts: [], toneDescriptor: '' };

/**
 * Turns a 1–5 aesthetic centroid into a short tone descriptor. Only clearly-
 * leaning dimensions contribute, so a neutral profile yields ''. Mirrors the
 * curator-note generator's `describeTone` (kept local so discovery stays
 * self-contained); axis polarity matches AestheticScoreVector's documented poles.
 */
function describeTone(v: AestheticScoreVector | null | undefined): string {
  if (!v) return '';
  const traits: string[] = [];
  const lean = (value: number, low: string, high: string, lo = 2.6, hi = 3.4) => {
    if (value <= lo) traits.push(low);
    else if (value >= hi) traits.push(high);
  };
  lean(v.contemplative, 'propulsive', 'contemplative');
  lean(v.concrete, 'concrete', 'abstract');
  lean(v.personal, 'intimate', 'wide-angle');
  lean(v.playful, 'playful and wry', 'serious');
  lean(v.specialist, 'accessible', 'specialist');
  lean(v.emotional, 'cool and analytical', 'emotionally resonant');
  return traits.join(', ');
}

/**
 * Loads Kyle's taste context for a discovery run. Resolves the most-recent
 * feedback identity, then its long-term aesthetic centroid + top concept labels.
 * Never throws — returns EMPTY_TASTE_CONTEXT on a cold start or any DB error.
 */
export async function loadTasteContext(): Promise<TasteContext> {
  try {
    const identity = await getMostRecentFeedbackIdentity();
    if (!identity) return EMPTY_TASTE_CONTEXT;
    const { userId, deviceId } = identity;
    const [profile, conceptNodes] = await Promise.all([
      getAestheticProfile(userId, deviceId).catch(() => null),
      getTopConceptNodes(userId, deviceId, 14).catch(() => []),
    ]);
    return {
      topConcepts: conceptNodes.map((c) => c.label),
      toneDescriptor: describeTone(profile?.centroid ?? null),
    };
  } catch (err) {
    appendLog(`[discovery] taste-context load skipped (${err instanceof Error ? err.message : String(err)})`);
    return EMPTY_TASTE_CONTEXT;
  }
}
