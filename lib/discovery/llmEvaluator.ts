// SERVER-SIDE ONLY — never import in browser bundles.

import { UNTRUSTED_CONTENT_NOTICE, wrapUntrusted } from '@/lib/utils/promptSafety';
import { getLlm } from '@/lib/llm';
import type { LlmProvider, JsonSchema } from '@/lib/llm/types';
import { LlmError } from '@/lib/llm/types';

const SCORE_ARTICLE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    intellectual_substance:    { type: 'integer', minimum: 1, maximum: 5 },
    originality:               { type: 'integer', minimum: 1, maximum: 5 },
    cross_disciplinary_appeal: { type: 'integer', minimum: 1, maximum: 5 },
    evergreen_durability:      { type: 'integer', minimum: 1, maximum: 5 },
    writing_quality:           { type: 'integer', minimum: 1, maximum: 5 },
  },
  required: [
    'intellectual_substance', 'originality',
    'cross_disciplinary_appeal', 'evergreen_durability', 'writing_quality',
  ],
};

export interface LLMScores {
  intellectual_substance: number;
  originality: number;
  cross_disciplinary_appeal: number;
  evergreen_durability: number;
  writing_quality: number;
  /** Arithmetic mean of all five scores, rounded to 2 decimal places. */
  composite: number;
}

export interface LLMEvalSuccess {
  success: true;
  scores: LLMScores;
}

export interface LLMEvalFailure {
  success: false;
  reason: 'parse_error' | 'api_error';
  detail?: string;
}

export type LLMEvalResult = LLMEvalSuccess | LLMEvalFailure;

/**
 * Evaluates article content quality using the LLM provider supplied.
 * This is the testable inner function — pass in an LlmProvider to decouple from
 * the active-provider factory / env vars.
 */
export async function evaluateWithLLMClient(
  provider: LlmProvider,
  title: string,
  description: string,
  bodyText: string
): Promise<LLMEvalResult> {
  let input: Record<string, unknown>;
  try {
    input = await provider.generateStructured<Record<string, unknown>>({
      schema: SCORE_ARTICLE_SCHEMA,
      toolName: 'score_article',
      toolDescription: 'Return quality scores for the article.',
      system: `You are an editorial evaluator for a personalized content discovery system.
Your task is to assess whether a piece of writing meets a high curatorial bar —
the kind of writing that would be recommended by publications like The Browser,
The Marginalian, or Arts & Letters Daily.

Evaluate the article across exactly five dimensions. For each dimension, assign
an integer score from 1 (very low) to 5 (very high).

Dimensions:
- intellectual_substance: Does the piece develop a real argument, finding, or insight? Is there something the reader would not know after reading a generic summary on the topic?
- originality: Does the author have a distinct perspective, voice, or angle? Does it reflect genuine independent thought rather than recapping known information?
- cross_disciplinary_appeal: Does the piece connect ideas across domains, or draw on an unusual combination of fields? Would it interest someone outside the specific subject area?
- evergreen_durability: Will this piece still be worth reading in a year? Is it anchored to a transient news event, or does it address something foundational?
- writing_quality: Is the prose clear, precise, and crafted with care? Is it worth reading for the writing itself, not just the information?

Score as a thoughtful, widely-read editor — not as a classifier pattern-matching on surface signals. A 5 means genuinely exceptional. A 3 means adequate but unremarkable. A 1 means generic, poorly written, or purely informational without insight.

${UNTRUSTED_CONTENT_NOTICE}`,
      user: wrapUntrusted(
        `Title: ${title}\nDescription: ${description}\nBody (first 3000 characters):\n${bodyText.slice(0, 3000)}`
      ),
      maxTokens: 256,
    });
  } catch (err) {
    // Preserve the pre-abstraction reason mapping: a malformed/missing
    // structured response → parse_error; everything else (network/API) →
    // api_error.
    if (err instanceof LlmError && err.kind === 'parse') {
      return { success: false, reason: 'parse_error', detail: err.message };
    }
    return {
      success: false,
      reason: 'api_error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const dims = [
    'intellectual_substance',
    'originality',
    'cross_disciplinary_appeal',
    'evergreen_durability',
    'writing_quality',
  ] as const;

  // Validate all five fields are integers in [1, 5]
  for (const dim of dims) {
    const val = input[dim];
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 1 || val > 5) {
      return {
        success: false,
        reason: 'parse_error',
        detail: `Invalid value for ${dim}: ${JSON.stringify(val)}`,
      };
    }
  }

  const intellectual_substance = input.intellectual_substance as number;
  const originality = input.originality as number;
  const cross_disciplinary_appeal = input.cross_disciplinary_appeal as number;
  const evergreen_durability = input.evergreen_durability as number;
  const writing_quality = input.writing_quality as number;

  const composite = Math.round(
    ((intellectual_substance + originality + cross_disciplinary_appeal + evergreen_durability + writing_quality) / 5) * 100
  ) / 100;

  return {
    success: true,
    scores: {
      intellectual_substance,
      originality,
      cross_disciplinary_appeal,
      evergreen_durability,
      writing_quality,
      composite,
    },
  };
}

/**
 * Evaluates the article using the active LLM provider (lib/llm).
 */
export async function evaluateWithLLM(
  title: string,
  description: string,
  bodyText: string
): Promise<LLMEvalResult> {
  return evaluateWithLLMClient(getLlm(), title, description, bodyText);
}
