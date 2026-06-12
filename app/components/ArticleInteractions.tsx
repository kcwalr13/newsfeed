'use client';

// Client component for the article reading view: dwell timer + Pass/Underline/Read later feedback.

import { useState, useEffect, useRef, useCallback } from 'react';
import { getFeedback, setFeedbackWithDwell, setFeedback, clearFeedback } from '@/lib/feedback/store';

interface Props {
  articleId: string;
}

type Verb = 'like' | 'dislike' | 'save' | null;

const VERB_META = {
  dislike: { verb: 'Pass',       desc: 'Not for me',      confirm: 'Noted. The next issue will reflect this.' },
  like:    { verb: 'Underline',  desc: 'This resonated',  confirm: 'Noted. More in this voice.' },
  save:    { verb: 'Read later', desc: 'Send to my shelf', confirm: 'Sent to your shelf.' },
} as const;

/**
 * Tracks foreground dwell time using the visibilitychange API.
 * Returns a stable getter function that computes total foreground seconds at call time.
 */
function useDwellTimer(): () => number {
  const dwellMsRef = useRef(0);
  const lastVisibleRef = useRef<number | null>(null);

  useEffect(() => {
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
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return useCallback(() => {
    let total = dwellMsRef.current;
    if (lastVisibleRef.current !== null) total += Date.now() - lastVisibleRef.current;
    return Math.floor(total / 1000);
  }, []);
}

export default function ArticleInteractions({ articleId }: Props) {
  const [feedback, setFeedbackState] = useState<Verb>(
    () => getFeedback(articleId) ?? null
  );
  const [confirmed, setConfirmed] = useState<Verb>(null);
  const feedbackGivenRef = useRef(false);
  const getDwellSeconds = useDwellTimer();

  // Passive beacon: send dwell time when user leaves without explicit feedback
  useEffect(() => {
    const sendBeacon = () => {
      const dwell = getDwellSeconds();
      if (dwell < 5 || feedbackGivenRef.current) return;
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

  function handleVerb(verb: 'like' | 'dislike' | 'save') {
    const dwell = getDwellSeconds();
    if (feedback === verb) {
      clearFeedback(articleId);
      setFeedbackState(null);
      setConfirmed(null);
      feedbackGivenRef.current = false;
    } else {
      if (verb === 'save') {
        setFeedback(articleId, 'save');
      } else {
        setFeedbackWithDwell(articleId, verb, dwell);
      }
      setFeedbackState(verb);
      setConfirmed(verb);
      feedbackGivenRef.current = true;
    }
  }

  return (
    <div>
      <div
        className="flex items-stretch justify-around"
        style={{ borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', padding: '10px 0' }}
      >
        {(['dislike', 'like', 'save'] as const).map((verb) => {
          const meta = VERB_META[verb];
          const isActive = feedback === verb;
          return (
            <button
              key={verb}
              onClick={() => handleVerb(verb)}
              aria-pressed={isActive}
              className="ql-verb-btn flex-1 flex flex-col items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
              style={isActive ? { color: 'var(--accent)' } : undefined}
            >
              <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: '17px', color: 'inherit' }}>
                {meta.verb}
              </span>
              <span className="ql-verb-label">{meta.desc}</span>
            </button>
          );
        })}
      </div>

      {confirmed && (
        <p
          className="ql-confirmation mt-3"
          style={{ fontSize: '13px', color: 'var(--muted)' }}
        >
          <em>{VERB_META[confirmed].confirm}</em>
        </p>
      )}
    </div>
  );
}
