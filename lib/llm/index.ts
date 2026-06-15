/**
 * LLM provider factory (R6-1 / R6-2).
 *
 * `getLlm()` returns the active provider adapter, selected by `LLM_PROVIDER`
 * (lib/config/llm.ts) and memoized for the process lifetime.
 *
 * Registered adapters:
 *   - `anthropic` → R6-2 (lib/llm/anthropic.ts)  ← active by default
 *   - `gemini`    → R6-4 (lib/llm/gemini.ts)      ← not yet registered
 */

import type { LlmProvider } from './types';
import { AnthropicProvider } from './anthropic';
import { LLM_PROVIDER, type LlmProviderName } from '@/lib/config/llm';

export type { LlmProvider } from './types';

let _cached: LlmProvider | null = null;

/** Returns the active LLM provider adapter (lazily constructed, memoized). */
export function getLlm(): LlmProvider {
  if (!_cached) _cached = createProvider(LLM_PROVIDER);
  return _cached;
}

function createProvider(name: LlmProviderName): LlmProvider {
  switch (name) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'gemini':
      // Gemini adapter lands in R6-4. Until then, selecting it is a config error.
      throw new Error('[llm] Gemini adapter is not registered yet (R6-4).');
    default:
      throw new Error(`[llm] Unknown LLM provider "${name}".`);
  }
}

/**
 * Whether the active provider has its API key set. Call sites that degrade
 * gracefully without an LLM (curator notes, issue theme, the query-bank script)
 * check this before attempting a call. Provider-aware so it stays correct after
 * the R6-5 switch — for `anthropic` it equals the old `!!ANTHROPIC_API_KEY`
 * guard, preserving R6-2 behavior.
 */
export function isLlmConfigured(): boolean {
  switch (LLM_PROVIDER) {
    case 'gemini':
      return !!process.env.GEMINI_API_KEY;
    case 'anthropic':
    default:
      return !!process.env.ANTHROPIC_API_KEY;
  }
}
