'use client';

/**
 * IssueCover
 *
 * Full-viewport cover shown on first load of the feed page when the issue
 * has been loaded. Displays issue number, date, theme, and themeNote in the
 * Quiet Library editorial style.
 *
 * Dismisses on click/tap anywhere. After dismissal, localStorage records the
 * date so the cover is not shown again today.
 */

import { useEffect, useRef, useState } from 'react';
import type { DailyIssue } from '@/lib/types/article';
import { useModalA11y } from '@/app/hooks/useModalA11y';

interface Props {
  issue: DailyIssue;
}

const COVER_STORAGE_KEY = 'tangent_cover_last_shown';
const COVER_DISMISSED_EVENT = 'tangent:cover-dismissed';

export default function IssueCover({ issue }: Props) {
  const [visible, setVisible] = useState(false);
  const coverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Show only once per day
    const today = new Date().toISOString().slice(0, 10);
    const lastShown = localStorage.getItem(COVER_STORAGE_KEY);
    if (lastShown === today) return;
    // Short delay so the feed content loads before the cover animates in
    const t = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(COVER_STORAGE_KEY, today);
    setVisible(false);
    // Let the editor's letter know it may show now.
    window.dispatchEvent(new Event(COVER_DISMISSED_EVENT));
  }

  useModalA11y(visible, coverRef, dismiss);

  if (!visible) return null;

  // Format arrivedAt to a readable time
  let arrivedStr = '';
  if (issue.arrivedAt) {
    try {
      arrivedStr = new Date(issue.arrivedAt).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
    } catch { /* ok */ }
  }

  return (
    <div
      ref={coverRef}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center cursor-pointer focus:outline-none"
      style={{
        background: 'var(--bg)',
        padding: '40px 24px',
        animation: 'ql-fade-in 0.5s ease-out forwards',
      }}
      onClick={dismiss}
      role="button"
      tabIndex={0}
      aria-label="Dismiss cover and open today's issue"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          dismiss();
        }
      }}
    >
      {/* Volume + issue number */}
      <p
        className="ql-mono mb-6"
        style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.22em' }}
      >
        {issue.volume.toUpperCase()} · ISSUE {String(issue.number).padStart(3, '0')}
      </p>

      {/* Masthead */}
      <h1
        className="ql-serif mb-2"
        style={{
          fontSize: '48px',
          fontStyle: 'italic',
          fontWeight: 500,
          color: 'var(--fg)',
          lineHeight: 1,
          letterSpacing: '-0.01em',
        }}
      >
        Tangent
      </h1>

      {/* Subtitle */}
      <p
        className="ql-mono mb-10"
        style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.22em' }}
      >
        A QUIET LIBRARY
      </p>

      {/* Hairline rule */}
      <div style={{ width: '100%', maxWidth: '320px', height: '1px', background: 'var(--rule)', marginBottom: '32px' }} />

      {/* Date */}
      <p
        className="ql-mono mb-3"
        style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.18em' }}
      >
        {issue.date.toUpperCase()}
      </p>

      {/* Theme */}
      <p
        className="ql-serif mb-3 text-center"
        style={{
          fontSize: '28px',
          fontStyle: 'italic',
          color: 'var(--fg)',
          lineHeight: 1.25,
          maxWidth: '320px',
        }}
      >
        {issue.theme}
      </p>

      {/* Theme note */}
      {issue.themeNote && (
        <p
          className="ql-serif text-center mb-10"
          style={{
            fontSize: '16px',
            fontStyle: 'italic',
            color: 'var(--muted)',
            lineHeight: 1.5,
            maxWidth: '280px',
          }}
        >
          {issue.themeNote}
        </p>
      )}

      {/* Arrived at */}
      {arrivedStr && (
        <p
          className="ql-mono mb-10"
          style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.14em' }}
        >
          {issue.count} PIECES · ARRIVED {arrivedStr}
        </p>
      )}

      {/* CTA */}
      <div
        className="ql-mono"
        style={{
          fontSize: '9px',
          color: 'var(--accent)',
          letterSpacing: '0.18em',
          borderBottom: '1px solid var(--accent)',
          paddingBottom: '1px',
        }}
      >
        OPEN TODAY&rsquo;S ISSUE →
      </div>
    </div>
  );
}
