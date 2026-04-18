'use client';

// Client component for the article reading view: dwell timer, like/dislike, and save button.

import { useState, useEffect, useRef, useCallback } from 'react';
import { getFeedback, setFeedbackWithDwell, setFeedback, clearFeedback } from '@/lib/feedback/store';

interface Props {
  articleId: string;
}

/**
 * Tracks foreground dwell time using the visibilitychange API.
 * Returns a stable getter function that computes total foreground seconds at call time.
 */
function useDwellTimer(): () => number {
  const dwellMsRef = useRef(0);
  const lastVisibleRef = useRef<number | null>(null);

  useEffect(() => {
    // Initialize: if page is already visible, start counting
    if (document.visibilityState === 'visible') {
      lastVisibleRef.current = Date.now();
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        lastVisibleRef.current = Date.now();
      } else if (lastVisibleRef.current !== null) {
        dwellMsRef.current += Date.now() - lastVisibleRef.current;
        lastVisibleRef.current = null;
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return useCallback(() => {
    let total = dwellMsRef.current;
    if (lastVisibleRef.current !== null) total += Date.now() - lastVisibleRef.current;
    return Math.floor(total / 1000);
  }, []);
}

export default function ArticleInteractions({ articleId }: Props) {
  const [feedback, setFeedbackState] = useState<'like' | 'dislike' | 'save' | null>(null);
  const feedbackGivenRef = useRef(false);
  const getDwellSeconds = useDwellTimer();

  useEffect(() => {
    setFeedbackState(getFeedback(articleId) ?? null);
  }, [articleId]);

  // Passive beacon: send dwell time when user leaves without explicit feedback
  useEffect(() => {
    const sendBeacon = () => {
      const dwell = getDwellSeconds();
      if (dwell < 5) return;
      if (feedbackGivenRef.current) return; // explicit feedback already sent dwell with it

      const payload = JSON.stringify({ articleId, value: null, dwellSeconds: dwell });
      navigator.sendBeacon('/api/feedback', new Blob([payload], { type: 'application/json' }));
    };

    const onHide = () => {
      if (document.visibilityState === 'hidden') sendBeacon();
    };

    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', sendBeacon);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', sendBeacon);
    };
  }, [articleId, getDwellSeconds]);

  function handleLike() {
    const dwell = getDwellSeconds();
    if (feedback === 'like') {
      clearFeedback(articleId);
      setFeedbackState(null);
      feedbackGivenRef.current = false;
    } else {
      setFeedbackWithDwell(articleId, 'like', dwell);
      setFeedbackState('like');
      feedbackGivenRef.current = true;
    }
  }

  function handleDislike() {
    const dwell = getDwellSeconds();
    if (feedback === 'dislike') {
      clearFeedback(articleId);
      setFeedbackState(null);
      feedbackGivenRef.current = false;
    } else {
      setFeedbackWithDwell(articleId, 'dislike', dwell);
      setFeedbackState('dislike');
      feedbackGivenRef.current = true;
    }
  }

  function handleSave() {
    if (feedback === 'save') {
      clearFeedback(articleId);
      setFeedbackState(null);
      feedbackGivenRef.current = false;
    } else {
      setFeedback(articleId, 'save');
      setFeedbackState('save');
      feedbackGivenRef.current = true;
    }
  }

  return (
    <div className="flex items-center gap-1">
      {/* Like button */}
      <button
        onClick={handleLike}
        aria-label="Like this article"
        aria-pressed={feedback === 'like'}
        className={
          feedback === 'like'
            ? 'rounded-full p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-white bg-green-600 transition-colors'
            : 'rounded-full p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors'
        }
      >
        {feedback === 'like' ? (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7.493 18.75c-.425 0-.82-.236-.975-.632A7.48 7.48 0 016 15.375c0-1.75.599-3.358 1.602-4.634.151-.192.373-.309.6-.397.473-.183.89-.514 1.212-.924a9.042 9.042 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75 2.25 2.25 0 012.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H14.23c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23h-.777zM2.331 10.977a11.969 11.969 0 00-.831 4.398 12 12 0 00.52 3.507c.26.85 1.084 1.368 1.973 1.368H4.9c.445 0 .72-.498.523-.898a8.963 8.963 0 01-.924-3.977c0-1.708.476-3.305 1.302-4.666.245-.403-.028-.959-.5-.959H4.25c-.832 0-1.612.453-1.918 1.227z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.75c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.203 4.167 9.75 5 9.75h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z" />
          </svg>
        )}
      </button>

      {/* Dislike button */}
      <button
        onClick={handleDislike}
        aria-label="Dislike this article"
        aria-pressed={feedback === 'dislike'}
        className={
          feedback === 'dislike'
            ? 'rounded-full p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-white bg-rose-600 transition-colors'
            : 'rounded-full p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors'
        }
      >
        {feedback === 'dislike' ? (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M15.73 5.25h1.035A7.465 7.465 0 0118 9.375a7.465 7.465 0 01-1.235 4.125h-.148c-.806 0-1.534.446-2.031 1.08a9.04 9.04 0 01-2.861 2.4c-.723.384-1.35.956-1.653 1.715a4.498 4.498 0 00-.322 1.672V21a.75.75 0 01-.75.75 2.25 2.25 0 01-2.25-2.25c0-1.152.26-2.243.723-3.218C7.74 15.724 7.366 15 6.748 15H3.622c-1.026 0-1.945-.694-2.054-1.715A12.134 12.134 0 011.5 12c0-2.848.992-5.464 2.649-7.521.388-.482.987-.729 1.605-.729H9.77a4.5 4.5 0 011.423.23l3.114 1.04a4.5 4.5 0 001.423.23zM21.669 13.023c.536-1.362.831-2.845.831-4.398 0-1.22-.182-2.398-.52-3.507-.26-.85-1.084-1.368-1.973-1.368H19.1c-.445 0-.72.498-.523.898.591 1.2.924 2.55.924 3.977a8.959 8.959 0 01-1.302 4.666c-.245.403.028.959.5.959h1.053c.832 0 1.612-.453 1.918-1.227z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 15h2.25m8.024-9.75c.011.05.028.1.052.148.591 1.2.924 2.55.924 3.977a8.96 8.96 0 01-.999 4.125m.023-8.25c-.076-.365.183-.75.575-.75h.908c.889 0 1.713.518 1.972 1.368.339 1.11.521 2.287.521 3.507 0 1.553-.295 3.036-.831 4.398C20.613 14.547 19.833 15 19 15h-1.053c-.472 0-.745-.556-.5-.96a8.95 8.95 0 00.303-.54m.023-8.25H16.48a4.5 4.5 0 01-1.423-.23l-3.114-1.04a4.5 4.5 0 00-1.423-.23H6.504c-.618 0-1.217.247-1.605.729A11.95 11.95 0 002.25 12c0 .434.023.863.068 1.285C2.427 14.306 3.346 15 4.372 15h3.126c.618 0 .991.724.725 1.282A7.471 7.471 0 007.5 19.5a2.25 2.25 0 002.25 2.25.75.75 0 00.75-.75v-.633c0-.573.11-1.14.322-1.672.304-.76.93-1.33 1.653-1.715a9.04 9.04 0 002.86-2.4c.498-.634 1.226-1.08 2.032-1.08h.384" />
          </svg>
        )}
      </button>

      {/* Save/bookmark button */}
      <button
        onClick={handleSave}
        aria-label={feedback === 'save' ? 'Remove bookmark' : 'Save for later'}
        aria-pressed={feedback === 'save'}
        className={
          feedback === 'save'
            ? 'rounded-full p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-white bg-blue-600 transition-colors'
            : 'rounded-full p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors'
        }
      >
        {feedback === 'save' ? (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M6.32 2.577a49.255 49.255 0 0111.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 01-1.085.67L12 18.089l-7.165 3.583A.75.75 0 013.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
          </svg>
        )}
      </button>
    </div>
  );
}

