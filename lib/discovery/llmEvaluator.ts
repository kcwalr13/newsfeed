// SERVER-SIDE ONLY — never import in browser bundles.

import Anthropic from '@anthropic-ai/sdk';
import { UNTRUSTED_CONTENT_NOTICE, wrapUntrusted } from '@/lib/utils/promptSafety';
import { LLM_MODEL } from '@/lib/config/llm';

/** Model used for content evaluation. Do not hardcode inline; use this constant. */
const LLM_EVAL_MODEL = LLM_MODEL;

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
 * Evaluates article content quality using the LLM client provided.
 * This is the testable inner function — pass in an Anthropic client to decouple from env vars.
 */
export async function evaluateWithLLMClient(
  client: Anthropic,
  title: string,
  description: string,
  bodyText: string
): Promise<LLMEvalResult> {
  try {
    const response = await client.messages.create({
      model: LLM_EVAL_MODEL,
      max_tokens: 256,
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
      tools: [{
        name: 'score_article',
        description: 'Return quality scores for the article.',
        input_schema: {
          type: 'object' as const,
          properties: {
            intellectual_substance:    { type: 'integer', minimum: 1, maximum: 5 },
            originality:               { type: 'integer', minimum: 1, maximum: 5 },
            cross_disciplinary_appeal: { type: 'integer', minimum: 1, maximum: 5 },
            evergreen_durability:      { type: 'integer', minimum: 1, maximum: 5 },
            writing_quality:           { type: 'integer', minimum: 1, maximum: 5 },
          },
          required: [
            'intellectual_substance', 'originality',
            'cross_disciplinary_appeal', 'evergreen_durability', 'writing_quality'
          ],
        },
      }],
      tool_choice: { type: 'tool', name: 'score_article' },
      messages: [{
        role: 'user',
        content: wrapUntrusted(
          `Title: ${title}\nDescription: ${description}\nBody (first 3000 characters):\n${bodyText.slice(0, 3000)}`
        ),
      }],
    });

    // Find the tool_use block for score_article
    const toolBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === 'score_article'
    );

    if (!toolBlock) {
      return { success: false, reason: 'parse_error', detail: 'No score_article tool_use block found' };
    }

    const input = toolBlock.input as Record<string, unknown>;
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, reason: 'api_error', detail: msg };
  }
}

/**
 * Creates an Anthropic client from ANTHROPIC_API_KEY and evaluates the article.
 */
export async function evaluateWithLLM(
  title: string,
  description: string,
  bodyText: string
): Promise<LLMEvalResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return evaluateWithLLMClient(client, title, description, bodyText);
}
