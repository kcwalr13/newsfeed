// Phase 3: LLM concept extraction from liked article body text.

import { AESTHETIC_BODY_MAX_CHARS } from '@/lib/config/aesthetic';
import { UNTRUSTED_CONTENT_NOTICE, wrapUntrusted } from '@/lib/utils/promptSafety';
import { getLlm } from '@/lib/llm';
import type { JsonSchema } from '@/lib/llm/types';

const CONCEPT_EXTRACTION_SYSTEM_PROMPT = `You extract the specific intellectual concepts, ideas, and themes that an article engages with. A concept label is 2–5 words and names a specific idea, not a broad category. Extract 5–8 concepts per article.

Good concept labels: "deliberative democracy theory", "urban heat islands", "fermentation science", "marginal gains theory", "distributed cognition", "brutalist urban planning".

Bad concept labels (too broad, not concepts): "politics", "technology", "science", "history", "culture", "economics".

Extract concepts that represent the actual intellectual territory of the article — what someone would remember having learned about if they read it carefully. Return only the extract_concepts tool call.`;

const EXTRACT_CONCEPTS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    concepts: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 10,
      description: 'Array of 5–8 concept labels, each 2–5 words.',
    },
  },
  required: ['concepts'],
};

/**
 * Extracts 5–8 intellectual concept labels from the provided body text using
 * Claude Haiku structured output.
 *
 * @param bodyText  Full or truncated article body text
 * @returns Array of concept label strings (2–5 words each)
 * @throws On any LLM or response parsing error — callers must catch and swallow
 */
export async function extractConcepts(bodyText: string): Promise<string[]> {
  const truncated = bodyText.slice(0, AESTHETIC_BODY_MAX_CHARS);

  const input = await getLlm().generateStructured<{ concepts?: unknown }>({
    schema: EXTRACT_CONCEPTS_SCHEMA,
    toolName: 'extract_concepts',
    toolDescription: 'Extract the core intellectual concepts from the supplied article text.',
    system: `${CONCEPT_EXTRACTION_SYSTEM_PROMPT}\n\n${UNTRUSTED_CONTENT_NOTICE}`,
    user: wrapUntrusted(truncated),
    maxTokens: 512,
  });

  if (!Array.isArray(input.concepts)) {
    throw new Error('[conceptExtractor] tool input.concepts is not an array');
  }

  const concepts = input.concepts.filter(
    (c): c is string => typeof c === 'string' && c.trim().length > 0
  );

  if (concepts.length < 2) {
    console.warn(`[conceptExtractor] Received only ${concepts.length} concepts (expected 5–8)`);
  }
  if (concepts.length > 10) {
    console.warn(`[conceptExtractor] Received ${concepts.length} concepts (expected ≤10)`);
  }

  return concepts;
}
