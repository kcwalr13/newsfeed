/**
 * Runs `fn` over `items` in chunks of `concurrency`, awaiting each chunk before
 * starting the next. Per-item failures are isolated — `fn` is expected to handle
 * its own errors; `Promise.allSettled` is a backstop so one rejection never
 * aborts the rest of the batch.
 *
 * Shared by the pipeline per-article LLM loops (DAT-H2) and discovery's
 * body-extraction + LLM evaluation (R2-18).
 */
export async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const size = Math.max(1, concurrency);
  for (let i = 0; i < items.length; i += size) {
    await Promise.allSettled(items.slice(i, i + size).map(fn));
  }
}
