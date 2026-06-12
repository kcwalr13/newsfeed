'use client';

/**
 * ArticleBodyClient
 *
 * Renders the article body paragraphs with:
 * - data-para-idx attributes for IntersectionObserver tracking
 * - "You stopped here" fleuron marker at the saved paragraph
 * - "A small victory" overlay when all paragraphs have been read
 * - Scroll-to-position on mount when resuming
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import ReadingPositionTracker from './ReadingPositionTracker';
import Link from 'next/link';
import { useModalA11y } from '@/app/hooks/useModalA11y';

interface Props {
  articleId: string;
  paragraphs: string[];
}

export default function ArticleBodyClient({ articleId, paragraphs }: Props) {
  const [stoppedAt,  setStoppedAt]  = useState<number | null>(null);
  const [finished,   setFinished]   = useState(false);
  const [showVictory, setShowVictory] = useState(false);
  const paragraphRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const victoryRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const victoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear pending timers on unmount — they otherwise fire against an
  // unmounted article on fast navigation (FE-M9).
  useEffect(
    () => () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      if (victoryTimerRef.current) clearTimeout(victoryTimerRef.current);
    },
    []
  );

  const dismissVictory = useCallback(() => setShowVictory(false), []);
  useModalA11y(showVictory, victoryRef, dismissVictory);

  const handlePositionLoaded = useCallback((index: number, wasFinished: boolean) => {
    if (wasFinished) {
      // Already finished before — don't show marker or victory again
      return;
    }
    if (index > 0) {
      setStoppedAt(index);
      // Scroll to a few paragraphs before the stop point so the reader sees context
      const scrollToIdx = Math.max(0, index - 1);
      scrollTimerRef.current = setTimeout(() => {
        paragraphRefs.current[scrollToIdx]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 400);
    }
  }, []);

  const handleFinished = useCallback(() => {
    setFinished(true);
    setStoppedAt(null);
    // Brief delay before showing the victory screen so the last paragraph is visible
    victoryTimerRef.current = setTimeout(() => setShowVictory(true), 800);
  }, []);

  // Dismiss stopped-here marker once user scrolls past it
  useEffect(() => {
    if (stoppedAt === null) return;
    const el = paragraphRefs.current[stoppedAt];
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            // User reached the stopped point — clear the marker
            setStoppedAt(null);
            obs.disconnect();
          }
        }
      },
      { threshold: 0.6 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [stoppedAt]);

  return (
    <>
      <ReadingPositionTracker
        articleId={articleId}
        paragraphCount={paragraphs.length}
        onPositionLoaded={handlePositionLoaded}
        onFinished={handleFinished}
      />

      <div
        className="ql-serif"
        style={{ fontSize: '18px', lineHeight: 1.7, color: 'var(--fg)' }}
      >
        {paragraphs.map((para, i) => (
          <div key={i}>
            {/* "You stopped here" fleuron marker */}
            {stoppedAt === i && (
              <div
                className="flex items-center gap-3 my-4"
                style={{ color: 'var(--accent)', opacity: 0.7 }}
              >
                <div style={{ flex: 1, height: '1px', background: 'var(--accent)', opacity: 0.3 }} />
                <span
                  className="ql-mono"
                  style={{ fontSize: '9px', letterSpacing: '0.18em' }}
                >
                  YOU STOPPED HERE
                </span>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: '16px' }}>❦</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--accent)', opacity: 0.3 }} />
              </div>
            )}
            <p
              ref={(el) => { paragraphRefs.current[i] = el; }}
              data-para-idx={i}
              style={{
                marginBottom: '1.2em',
                // Softly dim paragraphs already read (before the stop point)
                opacity: stoppedAt !== null && i < stoppedAt ? 0.55 : 1,
                transition: 'opacity 0.3s',
              }}
            >
              {para}
            </p>
          </div>
        ))}
      </div>

      {/* "A small victory" finish overlay */}
      {showVictory && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowVictory(false)}
        >
          <div
            ref={victoryRef}
            role="dialog"
            aria-modal="true"
            aria-label="You finished the article"
            tabIndex={-1}
            className="max-w-xs w-full mx-6 rounded-sm text-center focus:outline-none"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--rule)',
              padding: '40px 32px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Fleuron */}
            <p
              className="ql-serif mb-4"
              style={{ fontSize: '28px', color: 'var(--accent)', opacity: 0.8 }}
            >
              ❦
            </p>

            <h2
              className="ql-serif mb-3"
              style={{
                fontSize: '22px',
                fontStyle: 'italic',
                fontWeight: 500,
                color: 'var(--fg)',
                lineHeight: 1.3,
              }}
            >
              A small victory.
            </h2>

            <p
              className="ql-serif mb-8"
              style={{ fontSize: '16px', fontStyle: 'italic', color: 'var(--muted)', lineHeight: 1.5 }}
            >
              You read the whole thing.
            </p>

            <div className="flex flex-col gap-3">
              <Link
                href="/"
                className="ql-mono block focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm py-3"
                style={{
                  fontSize: '9px',
                  letterSpacing: '0.18em',
                  color: 'var(--bg)',
                  background: 'var(--accent)',
                  textDecoration: 'none',
                  textAlign: 'center',
                  minHeight: '44px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ← BACK TO THE ISSUE
              </Link>

              <button
                onClick={() => setShowVictory(false)}
                className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm py-2"
                style={{
                  fontSize: '9px',
                  letterSpacing: '0.18em',
                  color: 'var(--muted)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  minHeight: '44px',
                }}
              >
                STAY AND RE-READ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subtle "finished" indicator inline at bottom of article */}
      {finished && !showVictory && (
        <div
          className="flex items-center justify-center gap-2 mt-2 mb-4"
          style={{ color: 'var(--accent)', opacity: 0.6 }}
        >
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: '14px' }}>❦</span>
          <span className="ql-mono" style={{ fontSize: '8px', letterSpacing: '0.18em' }}>
            READ
          </span>
        </div>
      )}
    </>
  );
}
