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
  const dwellStartRef    = useRef<number>(Date.now());
  const dwellTotalRef    = useRef<number>(0);
  const finishedRef      = useRef<boolean>(false);
  const saveTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedIndexRef    = useRef<number>(-1);   // last value successfully POSTed

  // ── Persist position ─────────────────────────────────────────────────────

  const savePosition = useCallback(
    async (force = false) => {
      const idx = currentIndexRef.current;
      if (!force && idx === savedIndexRef.current) return;  // nothing new

      const dwell = dwellTotalRef.current + Math.floor((Date.now() - dwellStartRef.current) / 1000);

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
    void (async () => {
      try {
        const res = await fetch(`/api/reading-position/${encodeURIComponent(articleId)}`);
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

    window.addEventListener('blur',           handleBlur);
    window.addEventListener('beforeunload',   handleUnload);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void savePosition(true);
    });

    return () => {
      window.removeEventListener('blur',         handleBlur);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [savePosition]);

  return null;   // renders nothing
}
