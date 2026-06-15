/**
 * Shared LLM rate limiter (R6-3).
 *
 * A single process-wide gate that spaces out LLM calls so a full pipeline run
 * (~70–90 calls, dominated by discovery eval + the unbounded curator-note
 * fan-out) stays under the active provider's requests-per-minute ceiling. Every
 * call from every adapter goes through it (wired as a decorator in
 * `lib/llm/index.ts`), so the per-loop concurrency knobs
 * (`PIPELINE_LLM_CONCURRENCY`, `DISCOVERY_LLM_CONCURRENCY`) become subordinate:
 * a loop may *dispatch* 4 at once, but the limiter meters when each actually
 * fires.
 *
 * Strategy — a fixed-interval (leaky-bucket) scheduler, NOT a bursting token
 * bucket: each acquired slot is spaced `60000 / rpm` ms after the previous one,
 * which guarantees ≤ rpm calls in EVERY rolling 60s window. A classic
 * capacity-`rpm` token bucket can momentarily emit up to 2×rpm within a single
 * rolling window (full burst + a window's worth of refill), which trips
 * Gemini free-tier's rolling-window RPM limit. Even spacing is the safest way
 * to hit the R6-5 acceptance ("no 429 storms"). See Decisions Log (R6-3).
 *
 * Behavior preservation: when `rpm` is non-finite (Anthropic — see
 * `PROVIDER_CONFIG`), this is a complete no-op (no waiting, no shared state
 * touched), so the Anthropic path is unchanged until R6-5 flips to Gemini.
 *
 * Scope caveat: the gate is per-process (per serverless instance). A single
 * pipeline run executes in one instance, so the run is metered correctly. It
 * does NOT coordinate across concurrent instances (a DB-backed limiter would —
 * out of scope here, and unnecessary for a single-user app whose bulk LLM
 * volume is one daily cron run). Documented in design §2 / R6-6.
 */

import { activeProviderConfig } from '@/lib/config/llm';

/** Next instant (ms epoch) a slot may fire. Shared across all calls/methods. */
let _nextFreeMs = 0;

/**
 * Pure slot-reservation math (no timers/clock), exported for testing.
 * Given the current time, the next-free instant, and the per-slot interval,
 * returns how long this caller must wait and the updated next-free instant.
 */
export function reserveSlot(
  nowMs: number,
  nextFreeMs: number,
  intervalMs: number,
): { waitMs: number; nextFreeMs: number } {
  const scheduled = Math.max(nowMs, nextFreeMs);
  return { waitMs: scheduled - nowMs, nextFreeMs: scheduled + intervalMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/**
 * Acquires a rate-limited slot for one LLM call. Resolves immediately when the
 * active provider has no finite RPM (Anthropic), otherwise after enough delay
 * to keep the global call rate at/under the provider's RPM.
 */
export async function acquireLlmSlot(): Promise<void> {
  const { rpm } = activeProviderConfig();
  if (!Number.isFinite(rpm) || rpm <= 0) return; // unlimited → no-op

  const intervalMs = 60000 / rpm;
  // Reserve synchronously (single-threaded) so concurrent callers can't claim
  // the same slot, then wait out this caller's share.
  const { waitMs, nextFreeMs } = reserveSlot(Date.now(), _nextFreeMs, intervalMs);
  _nextFreeMs = nextFreeMs;
  if (waitMs > 0) await sleep(waitMs);
}

/** Test/diagnostic hook: clears the shared schedule. */
export function __resetLlmLimiter(): void {
  _nextFreeMs = 0;
}
