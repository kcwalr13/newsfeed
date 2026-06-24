// SERVER-SIDE ONLY — never import in browser bundles.
//
// The LLM agentic stream (R7-3 stream 2) — the wildcard layer of the Round-7
// discovery engine. Per a rotating, taste-anchored theme, it asks the LLM to
// propose lesser-known, genuinely interesting ONE-OFF destinations across the
// type families (hand-built sites/web-toys, idiosyncratic blogs, standalone
// curiosities, obscure music/video, fascinating threads). This is where true
// wildcards (moltbook-class) come from.
//
// CRITICAL — verification is load-bearing: the model HALLUCINATES URLs and SKEWS
// popular/stale, so runLlmHunt() only PROPOSES candidates. Every proposed URL is
// then fetched + liveness-verified + interestingness-judged by the SAME funnel
// gauntlet as the index-mined candidates (it is folded into the funnel's raw pool
// via opts.extraCandidates). Nothing here is surfaced directly.
//
// Injection note: the proposal call sends NO fetched web page — only Kyle's own
// taste tags + our rotating theme (trusted, like the offline query-bank script,
// site 7). The untrusted surface (the fetched destination pages) is handled by
// the judge, which wrapUntrusted-fences them. So this call needs no fence.

import { getLlm, isLlmConfigured } from '@/lib/llm';
import type { LlmProvider, JsonSchema } from '@/lib/llm/types';
import { LLM_HUNT_PROPOSALS } from '@/lib/config/feed';
import { appendLog } from '@/lib/pipeline/storage';
import type { IndexCandidate } from './indexMiner';
import type { TasteContext } from './tasteContext';

/** Rotating discovery angles spanning the type families. One is chosen per run
 *  (by UTC day-of-month, so it rotates daily and is stable within a day for
 *  re-run safety) and woven together with Kyle's taste to anchor the prompt. */
const HUNT_ANGLES: readonly string[] = [
  'hand-built personal websites and digital gardens with a singular voice',
  'interactive, explorable explainers and generative web toys',
  'strange, beautiful, or delightfully pointless single-purpose websites',
  'obscure but wonderful music — small-label releases and odd sound projects',
  'archival curiosities, niche museum collections, and unusual databases',
  'idiosyncratic independent essays and blogs well off the beaten path',
  'clever standalone tools and playful experiments by indie makers',
];

/** The provenance label stamped on every stream-2 candidate. */
export const LLM_HUNT_SOURCE = 'llm-hunt';

const HUNT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    destinations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full https URL of a real, currently-live page.' },
          title: { type: 'string', description: 'A short title for the destination.' },
        },
        required: ['url'],
      },
    },
  },
  required: ['destinations'],
};

/** Picks the day's rotating angle. Stable within a UTC day (re-run safe). */
export function pickHuntAngle(dayOfMonth: number): string {
  const i = ((dayOfMonth % HUNT_ANGLES.length) + HUNT_ANGLES.length) % HUNT_ANGLES.length;
  return HUNT_ANGLES[i];
}

function buildSystemPrompt(): string {
  return (
    'You are a discovery scout for Tangent, a personal companion that surfaces the most genuinely ' +
    'interesting ONE-OFF things on the internet for ONE reader. Propose specific destination URLs ' +
    'that are real one-off gems — hand-made, idiosyncratic, surprising, the kind of thing a curious ' +
    'friend would send. HARD RULES: (1) Only pages you are confident actually exist and are currently ' +
    'live — do NOT invent or guess URLs. (2) NO mainstream/popular sites (no youtube, wikipedia, reddit, ' +
    'major news/publications, big platforms, app stores). (3) NO company, product, SaaS, marketing, ' +
    'pricing, or infrastructure pages — a homepage that sells something is not a find. (4) Prefer small, ' +
    'independent, personal, hand-built things. Favor lesser-known over famous. Return a JSON object with ' +
    'a "destinations" array of {url, title}.'
  );
}

function buildUserPrompt(angle: string, taste: TasteContext, count: number): string {
  const lines: string[] = [
    `Propose up to ${count} lesser-known one-off destinations that fit this theme:`,
    `  ${angle}`,
  ];
  if (taste.topConcepts.length > 0) {
    // topConcepts are LLM-derived but sanitized at the tasteContext boundary
    // (control chars stripped, length-clamped), so a laundered directive can't
    // survive into this generation prompt (R7-3 review). The judge — where a
    // flipped verdict would matter — additionally fences them.
    lines.push('', `Lean toward this reader's interests where it fits naturally (but stay surprising): ${taste.topConcepts.slice(0, 10).join(', ')}.`);
  }
  if (taste.toneDescriptor) {
    lines.push(`Their reading texture: ${taste.toneDescriptor}.`);
  }
  lines.push('', 'Range across types where the theme allows: websites, web-toys, blogs, standalone curiosities, music, video, threads. Avoid anything popular or commercial.');
  return lines.join('\n');
}

/** Validates + normalizes a proposed URL: must parse as an absolute http(s) URL. */
function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * The testable inner hunt: proposes destinations with the supplied provider for a
 * given angle. Never throws — returns [] on any failure (the model is allowed to
 * fail; the rest of the funnel just runs without stream-2 candidates).
 */
export async function runLlmHuntWithClient(
  provider: LlmProvider,
  angle: string,
  taste: TasteContext,
  count: number = LLM_HUNT_PROPOSALS
): Promise<IndexCandidate[]> {
  let raw: { destinations?: unknown };
  try {
    raw = await provider.generateStructured<{ destinations?: unknown }>({
      schema: HUNT_SCHEMA,
      toolName: 'propose_destinations',
      toolDescription: 'Propose lesser-known one-off destination URLs for the theme.',
      system: buildSystemPrompt(),
      user: buildUserPrompt(angle, taste, count),
      maxTokens: 1024,
    });
  } catch (err) {
    appendLog(`[llm-hunt] proposal call failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  const arr = Array.isArray(raw?.destinations) ? raw.destinations : [];
  const seen = new Set<string>();
  const out: IndexCandidate[] = [];
  for (const d of arr) {
    if (out.length >= count) break;
    const o = d as Record<string, unknown>;
    const url = normalizeUrl(o?.url);
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title: typeof o?.title === 'string' ? o.title.slice(0, 200) : undefined,
      discoverySource: LLM_HUNT_SOURCE,
    });
  }
  return out;
}

/**
 * Runs the LLM agentic stream with the active provider for the day's rotating
 * theme. Returns proposed candidates (to be fed into the funnel for fetch-verify-
 * judge) or [] when no LLM is configured / the call fails. `dayOfMonth` defaults
 * to the current UTC day (re-run-stable within a day). Never throws.
 */
export async function runLlmHunt(
  taste: TasteContext,
  opts: { dayOfMonth?: number; count?: number } = {}
): Promise<IndexCandidate[]> {
  if (!isLlmConfigured()) {
    appendLog('[llm-hunt] LLM not configured — skipping the agentic stream');
    return [];
  }
  const day = opts.dayOfMonth ?? new Date().getUTCDate();
  const angle = pickHuntAngle(day);
  const proposals = await runLlmHuntWithClient(getLlm(), angle, taste, opts.count);
  appendLog(`[llm-hunt] angle="${angle}" proposed=${proposals.length}`);
  return proposals;
}
