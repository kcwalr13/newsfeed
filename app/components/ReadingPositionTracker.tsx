'use client';

/**
 * ReadingPositionTracker
 *
 * Invisible component that:
 * 1. Observes paragraph elements in the article body to track reading progress.
 * 2. Persists position to /api/reading-position on blur/unload.
 * 3. Exposes the saved position index via a callback so the reader page
 *    can show the "You stopped here" marker.
 */

import { useEffect, useRef, useCallback } from 'react';

interface Props {
  articleId: string;
  paragraphCount: number;
  /** Called with the paragraph index the server has stored (for scroll-to on mount). */
  onPositionLoaded?: (index: number, finished: boolean) => void;
  /** Called when the user reaches the last paragraph. */
  onFinished?: () => void;
}

const SAVE_DEBOUNCE_MS = 2000;

export default function ReadingPositionTracker({
  articleId,
  paragraphCount,
  onPositionLoaded,
  onFinished,
}: Props) {
  const currentIndexRef  = useRef<number>(0);
  // Mount timestamp: the initializer's value is kept only on first render
  // eslint-disable-next-line react-hooks/purity
  const dwellStartRef    = useRef<number>(Date.now());
  const dwellTotalRef    = useRef<number>(0);
  const finishedRef      = useRef<boolean>(false);
  const saveTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedIndexRef    = useRef<number>(-1);   // last value successfully POSTed
  const pausedRef        = useRef<boolean>(false); // true while the tab is hidden

  // ── Persist position ─────────────────────────────────────────────────────

  const savePosition = useCallback(
    async (force = false) => {
      const idx = currentIndexRef.current;
      if (!force && idx === savedIndexRef.current) return;  // nothing new

      // While the tab is hidden the dwell clock is paused, so don't add the
      // elapsed-since-checkpoint interval (it was accrued at pause time).
      const dwell = pausedRef.current
        ? dwellTotalRef.current
        : dwellTotalRef.current + Math.floor((Date.now() - dwellStartRef.current) / 1000);

      try {
        const body: Record<string, unknown> = {
          articleId,
          paragraphIndex: idx,
          dwellSeconds: dwell,
        };
        if (finishedRef.current) {
          body.finishedAt = new Date().toISOString();
        }
        await fetch('/api/reading-position', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,  // survives page unload
        });
        savedIndexRef.current = idx;
        dwellTotalRef.current = dwell;
        dwellStartRef.current = Date.now();
      } catch {
        // Non-blocking — reading still works without tracking
      }
    },
    [articleId]
  );

  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void savePosition(), SAVE_DEBOUNCE_MS);
  }, [savePosition]);

  // ── Load saved position on mount ─────────────────────────────────────────

  useEffect(() => {
    // Abort on unmount/article change: a slow response for the previous
    // article must not fire onPositionLoaded against the new one (FE-M9).
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/reading-position/${encodeURIComponent(articleId)}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as {
            paragraph_index: number;
            dwell_seconds: number;
            finished_at: string | null;
          };
          const idx = data.paragraph_index ?? 0;
          const finished = !!data.finished_at;
          currentIndexRef.current = idx;
          dwellTotalRef.current   = data.dwell_seconds ?? 0;
          savedIndexRef.current   = idx;
          onPositionLoaded?.(idx, finished);
        }
      } catch {
        // No saved position — start fresh
      }
    })();
    return () => controller.abort();
  }, [articleId, onPositionLoaded]);

  // ── IntersectionObserver: track the furthest-seen paragraph ──────────────

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = parseInt((entry.target as HTMLElement).dataset.paraIdx ?? '0', 10);
          if (idx > currentIndexRef.current) {
            currentIndexRef.current = idx;
            debouncedSave();
            if (idx >= paragraphCount - 1 && !finishedRef.current) {
              finishedRef.current = true;
              onFinished?.();
              void savePosition(true);
            }
          }
        }
      },
      { threshold: 0.4 }
    );

    // Observe all <p data-para-idx="N"> elements in the article body
    const paragraphs = document.querySelectorAll<HTMLElement>('[data-para-idx]');
    paragraphs.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [paragraphCount, debouncedSave, onFinished, savePosition]);

  // ── Save on page leave ────────────────────────────────────────────────────

  useEffect(() => {
    const handleBlur   = () => void savePosition(true);
    const handleUnload = () => void savePosition(true);
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Checkpoint accrued dwell, pause the clock, and persist.
        dwellTotalRef.current += Math.floor((Date.now() - dwellStartRef.current) / 1000);
        pausedRef.current = true;
        void savePosition(true);
      } else {
        // Resume: restart the dwell clock from now.
        dwellStartRef.current = Date.now();
        pausedRef.current = false;
      }
    };

    window.addEventListener('blur',                handleBlur);
    window.addEventListener('beforeunload',        handleUnload);
    document.addEventListener('visibilitychange',  handleVisibility);

    return () => {
      window.removeEventListener('blur',                handleBlur);
      window.removeEventListener('beforeunload',        handleUnload);
      document.removeEventListener('visibilitychange',  handleVisibility);
    };
  }, [savePosition]);

  // ── Flush position on unmount / article change ───────────────────────────
  // An in-app Next <Link> navigation unmounts this tracker (or swaps articleId)
  // without firing blur / beforeunload / visibilitychange, so the last scroll +
  // dwell sitting in the debounce — or any progress past the last save — would
  // be silently discarded (R2-04). Flush it synchronously with a keepalive POST
  // (savePosition already sets keepalive:true) if there's unsaved progress, then
  // clear the pending debounce timer. Depending on savePosition (which changes
  // with articleId) makes the cleanup also run on article→article navigation;
  // React runs all effect cleanups before any setup, so this captures the
  // previous article's index and closure before the load effect overwrites them.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (currentIndexRef.current !== savedIndexRef.current) {
        void savePosition(true);
      }
    };
  }, [savePosition]);

  return null;   // renders nothing
}
