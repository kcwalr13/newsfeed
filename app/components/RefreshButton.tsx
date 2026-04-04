'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Article, FeedResponse } from '@/lib/types/article';

interface Props {
  /** Called with the new generatedAt timestamp and articles after a successful refresh. */
  onRefreshSuccess: (newGeneratedAt: string, newArticles: Article[]) => void;
  /** Called with an error message string when the refresh fails. */
  onRefreshError: (message: string) => void;
}

type ButtonState = 'idle' | 'loading' | 'cooldown';

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

const refreshIcon = (
  <svg
    className="w-3.5 h-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

export default function RefreshButton({ onRefreshSuccess, onRefreshError }: Props) {
  const [buttonState, setButtonState] = useState<ButtonState>('idle');
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  useEffect(() => {
    if (buttonState !== 'cooldown' || secondsRemaining <= 0) return;
    const timer = setInterval(() => {
      setSecondsRemaining((s) => {
        if (s <= 1) {
          setButtonState('idle');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [buttonState, secondsRemaining]);

  const handleRefresh = useCallback(async () => {
    if (buttonState !== 'idle') return;
    setButtonState('loading');

    try {
      const res = await fetch('/api/feed/refresh', { method: 'POST' });
      const json = await res.json() as {
        ok?: boolean;
        error?: string;
        secondsRemaining?: number;
        batchDate?: string;
        count?: number;
      };

      if (res.ok) {
        // Reload the feed to pick up new articles and generatedAt
        try {
          const feedRes = await fetch('/api/feed/today');
          if (feedRes.ok) {
            const feedJson = await feedRes.json() as FeedResponse;
            onRefreshSuccess(feedJson.generatedAt ?? '', feedJson.articles);
          }
        } catch {
          // Feed reload failed after successful pipeline — still report success
          onRefreshSuccess('', []);
        }
        setButtonState('idle');
      } else if (res.status === 429) {
        setSecondsRemaining(json.secondsRemaining ?? 900);
        setButtonState('cooldown');
      } else {
        onRefreshError(json.error ?? 'Refresh failed. Please try again later.');
        setButtonState('idle');
      }
    } catch {
      onRefreshError('Refresh failed. Please try again later.');
      setButtonState('idle');
    }
  }, [buttonState, onRefreshSuccess, onRefreshError]);

  if (buttonState === 'loading') {
    return (
      <button
        disabled
        aria-label="Refreshing feed…"
        aria-busy="true"
        className="flex items-center gap-1.5 text-sm text-gray-400 px-3 py-2 rounded-lg
                   border border-gray-200 cursor-not-allowed select-none"
      >
        <svg
          className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        Refreshing…
      </button>
    );
  }

  if (buttonState === 'cooldown') {
    return (
      <button
        disabled
        aria-label={`Refresh available in ${formatSeconds(secondsRemaining)}`}
        className="text-sm text-gray-400 px-3 py-2 rounded-lg border border-gray-200
                   cursor-not-allowed select-none tabular-nums"
      >
        {formatSeconds(secondsRemaining)}
      </button>
    );
  }

  return (
    <button
      onClick={handleRefresh}
      aria-label="Refresh feed"
      className="flex items-center gap-1.5 text-sm text-gray-600 px-3 py-2 rounded-lg
                 border border-gray-200 hover:border-gray-300 hover:text-gray-900
                 transition-colors active:bg-gray-50"
    >
      {refreshIcon}
      Refresh
    </button>
  );
}
