/**
 * Single source of truth for the LLM model id used across the pipeline and
 * discovery (PIPE-L9). Change it here — scorer, evaluator, extractors, and
 * generators all import this constant.
 *
 * Round 6 extends this into a provider-aware config: `LLM_PROVIDER` selects the
 * active backend (`anthropic` | `gemini`), and `PROVIDER_CONFIG` carries each
 * provider's model id, rate-limit ceiling (consumed by the shared limiter,
 * R6-3), per-loop concurrency, and optional daily request cap. `LLM_MODEL`
 * stays the Anthropic default so existing imports keep working unchanged.
 */

/** Anthropic default model. Kept as a named export for back-compat (PIPE-L9). */
export const LLM_MODEL = 'claude-haiku-4-5-20251001';

/** The set of LLM backends the abstraction can target. */
export type LlmProviderName = 'anthropic' | 'gemini';

/** Per-provider operational config. */
export interface ProviderConfig {
  /** Model id passed to the provider's SDK. */
  model: string;
  /**
   * Requests-per-minute ceiling for the shared rate limiter (R6-3).
   * `Number.POSITIVE_INFINITY` means "do not throttle" — used for Anthropic so
   * behavior is unchanged until the Gemini switch (R6-5).
   */
  rpm: number;
  /** Per-loop concurrency the limiter subordinates (R6-3). */
  maxConcurrency: number;
  /** Optional requests-per-day cap the provider enforces (Gemini free tier). */
  dailyCap?: number;
}

/**
 * Resolves the active provider from `LLM_PROVIDER`. Defaults to `'anthropic'`
 * for back-compat; only the exact string `'gemini'` switches the backend.
 */
function parseProvider(raw: string | undefined): LlmProviderName {
  return raw?.trim().toLowerCase() === 'gemini' ? 'gemini' : 'anthropic';
}

/** Active provider, chosen by the `LLM_PROVIDER` env var (default `anthropic`). */
export const LLM_PROVIDER: LlmProviderName = parseProvider(process.env.LLM_PROVIDER);

/**
 * Per-provider table. Anthropic's rate is effectively unlimited (Infinity RPM,
 * no daily cap) so routing every call through the limiter is a no-op until
 * R6-5 flips the provider to Gemini. Gemini values are the 2.0 Flash free-tier
 * ceilings (verify at build — they move); R6-5 tunes them against the wall-clock
 * budget.
 */
export const PROVIDER_CONFIG: Record<LlmProviderName, ProviderConfig> = {
  anthropic: {
    model: LLM_MODEL,
    rpm: Number.POSITIVE_INFINITY,
    maxConcurrency: 4,
  },
  gemini: {
    // gemini-2.5-flash-lite: stable, free-tier, high-throughput, and "thinking"
    // is OFF by default (so a small maxOutputTokens isn't consumed by reasoning).
    // NOTE: gemini-2.0-flash was deprecated + shut down 2026-06-01 (free-tier
    // quota went to 0 → 429 RESOURCE_EXHAUSTED), so R6-5's original pick is dead.
    // Free-tier RPM/RPD are account-specific and move; 15 RPM is a safe ceiling
    // for the even-spacing limiter — lower it here if 429s persist.
    model: 'gemini-2.5-flash-lite',
    rpm: 15,
    maxConcurrency: 2,
    dailyCap: 1000,
  },
};

/** Config for the currently-active provider. */
export function activeProviderConfig(): ProviderConfig {
  return PROVIDER_CONFIG[LLM_PROVIDER];
}
