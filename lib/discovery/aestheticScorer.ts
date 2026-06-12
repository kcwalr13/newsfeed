// Aesthetic scorer module — scores article text on six aesthetic dimensions via Claude Haiku.

import Anthropic from '@anthropic-ai/sdk';
import type { AestheticScoreVector } from '@/lib/types/aesthetic';
import { AESTHETIC_SCALE_MIN, AESTHETIC_SCALE_MAX } from '@/lib/config/aesthetic';
import { UNTRUSTED_CONTENT_NOTICE, wrapUntrusted } from '@/lib/utils/promptSafety';
import { LLM_MODEL } from '@/lib/config/llm';

// Lazy client: constructing Anthropic() with a missing ANTHROPIC_API_KEY throws,
// and doing that at module load would crash every importer of this module.
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AestheticScoringError('ANTHROPIC_API_KEY is not set');
  }
  if (!_client) _client = new Anthropic();
  return _client;
}

const MODEL = LLM_MODEL;

const SYSTEM_PROMPT = `You are a thoughtful literary editor with wide reading experience across all genres and disciplines. Your task is to score a piece of writing on six aesthetic dimensions that describe how the writing *feels* to read — not what it is about or whether it is good.

Score each dimension on a continuous scale from 1.0 to 5.0:
- Use 3.0 for writing that is genuinely neutral on a dimension.
- Reserve 1.0 and 5.0 for writing that is clearly at an extreme.
- Decimal values (e.g., 2.5, 3.5, 4.0) are appropriate and encouraged.

The six dimensions:

1. contemplative (1=highly propulsive, 5=deeply contemplative)
   Propulsive: the piece moves quickly, builds urgency, drives the reader forward.
   Contemplative: the piece lingers, reflects, circles back, invites slowing down.

2. concrete (1=highly concrete, 5=highly abstract)
   Concrete: grounded in examples, cases, objects, people, sensory detail.
   Abstract: deals in ideas, systems, principles, frameworks with few anchors.

3. personal (1=highly personal, 5=highly universal)
   Personal: author's own experience, perspective, or memory is at the center.
   Universal: removed authoritative stance — research, journalism, argument.

4. playful (1=highly playful, 5=highly serious)
   Playful: humor, irony, wit, unexpected juxtaposition, lightness of touch.
   Serious: gravity, earnestness, weight — not somber, but without levity.

5. specialist (1=highly generalist, 5=highly specialist)
   Generalist: accessible to a curious non-expert; explains its terms.
   Specialist: assumes domain fluency; does not explain foundational vocabulary.

6. emotional (1=emotionally neutral, 5=emotionally resonant)
   Neutral: communicates information or argument with little emotional texture.
   Resonant: actively invites emotional engagement — wonder, melancholy, warmth.

Score the piece as it actually reads, not as the genre or subject would suggest. A technical tutorial can be warmly personal. A political essay can be playfully written. Judge the text, not the category.\n\n${UNTRUSTED_CONTENT_NOTICE}`;

const SCORE_TOOL: Anthropic.Tool = {
  name: 'score_aesthetic',
  description: 'Score the supplied text on six aesthetic dimensions.',
  input_schema: {
    type: 'object' as const,
    properties: {
      contemplative: { type: 'number', minimum: 1.0, maximum: 5.0 },
      concrete:      { type: 'number', minimum: 1.0, maximum: 5.0 },
      personal:      { type: 'number', minimum: 1.0, maximum: 5.0 },
      playful:       { type: 'number', minimum: 1.0, maximum: 5.0 },
      specialist:    { type: 'number', minimum: 1.0, maximum: 5.0 },
      emotional:     { type: 'number', minimum: 1.0, maximum: 5.0 },
    },
    required: ['contemplative', 'concrete', 'personal', 'playful', 'specialist', 'emotional'],
  },
};

export class AestheticScoringError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AestheticScoringError';
  }
}

/**
 * Scores a piece of text on six aesthetic dimensions using Claude Haiku.
 *
 * @param input - Pre-prepared text string. Caller is responsible for truncation
 *   and source selection (bodyText vs. title+description). This function does
 *   not modify the input.
 * @returns AestheticScoreVector with all six dimension scores in [1.0, 5.0].
 * @throws AestheticScoringError on any failure (network, API, malformed response,
 *   out-of-range values). The caller must catch and handle failures.
 */
export async function scoreAesthetic(input: string): Promise<AestheticScoreVector> {
  let response: Anthropic.Message;
  try {
    response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      tools: [SCORE_TOOL],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: wrapUntrusted(input) }],
    });
  } catch (err) {
    throw new AestheticScoringError(
      `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }

  // Extract the tool_use block from the response
  const toolUseBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
    throw new AestheticScoringError(
      `LLM response did not contain a tool_use block. stop_reason=${response.stop_reason}`
    );
  }

  const raw = toolUseBlock.input as Record<string, unknown>;

  // Validate all six fields are present and numeric
  const keys: Array<keyof AestheticScoreVector> = [
    'contemplative', 'concrete', 'personal', 'playful', 'specialist', 'emotional',
  ];
  for (const key of keys) {
    const val = raw[key];
    if (typeof val !== 'number') {
      throw new AestheticScoringError(
        `LLM returned non-numeric value for dimension "${key}": ${JSON.stringify(val)}`
      );
    }
    if (val < AESTHETIC_SCALE_MIN || val > AESTHETIC_SCALE_MAX) {
      throw new AestheticScoringError(
        `LLM returned out-of-range score for dimension "${key}": ${val} ` +
        `(expected ${AESTHETIC_SCALE_MIN}–${AESTHETIC_SCALE_MAX})`
      );
    }
  }

  return {
    contemplative: raw.contemplative as number,
    concrete:      raw.concrete      as number,
    personal:      raw.personal      as number,
    playful:       raw.playful       as number,
    specialist:    raw.specialist    as number,
    emotional:     raw.emotional     as number,
  };
}
