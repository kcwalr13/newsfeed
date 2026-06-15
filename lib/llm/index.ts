/**
 * LLM provider factory (R6-1).
 *
 * `getLlm()` returns the active provider adapter, selected by `LLM_PROVIDER`
 * (lib/config/llm.ts) and memoized for the process lifetime.
 *
 * Adapters are registered in later Round-6 steps:
 *   - `anthropic` → R6-2 (lib/llm/anthropic.ts)
 *   - `gemini`    → R6-4 (lib/llm/gemini.ts)
 *
 * No call site invokes `getLlm()` until R6-2 (the 7 sites still call the
 * Anthropic SDK directly), so the throwing default below is behavior-neutral
 * scaffolding — it cannot fire on any current code path.
 */

import type { LlmProvider } from './types';
import { LLM_PROVIDER, type LlmProviderName } from '@/lib/config/llm';

export type { LlmProvider } from './types';

let _cached: LlmProvider | null = null;

/** Returns the active LLM provider adapter (lazily constructed, memoized). */
export function getLlm(): LlmProvider {
  if (!_cached) _cached = createProvider(LLM_PROVIDER);
  return _cached;
}

function createProvider(name: LlmProviderName): LlmProvider {
  // Adapters land in R6-2 (anthropic) and R6-4 (gemini). Until then this throws;
  // safe because nothing calls getLlm() yet.
  throw new Error(`[llm] No adapter registered for provider "${name}" yet.`);
}
