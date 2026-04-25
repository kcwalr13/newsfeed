'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'tangent_onboarding_dismissed';

export default function EditorLetterModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) setVisible(true);
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="editors-letter-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(26,24,20,0.55)', backdropFilter: 'blur(2px)' }}
    >
      <div
        className="relative w-full max-w-lg rounded-sm"
        style={{
          background: 'var(--card)',
          padding: '40px 36px 32px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          border: '1px solid var(--rule)',
        }}
      >
        {/* Masthead */}
        <p
          className="ql-mono mb-6"
          style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.2em' }}
        >
          TANGENT · AN EDITORIAL NOTE
        </p>

        <hr className="ql-rule mb-6" />

        {/* Letter body */}
        <div id="editors-letter-title">
          <h2
            className="ql-serif"
            style={{ fontSize: '26px', fontStyle: 'italic', fontWeight: 500, color: 'var(--fg)', marginBottom: '20px', lineHeight: 1.25 }}
          >
            Seven pieces a day, in good type.
          </h2>
        </div>

        <div
          className="ql-serif space-y-4"
          style={{ fontSize: '17px', lineHeight: 1.65, color: 'var(--muted)' }}
        >
          <p>
            Every morning, your editor selects seven pieces — essays, arguments,
            observations — from across the web. Theory beside hobby. Music beside
            mathematics. The juxtaposition is intentional.
          </p>
          <p>
            Each piece is numbered. Read in order, skip what doesn't hold you,
            return to what does. The seven-dot strip at the top of the page marks
            your progress. It resets each morning.
          </p>
          <p>
            Use <em>Pass</em>, <em>Underline</em>, and <em>Read later</em> as
            your only controls. Your editor pays attention.
          </p>
        </div>

        <hr className="ql-rule mt-6 mb-5" />

        {/* Sign-off */}
        <div className="flex items-end justify-between">
          <p
            className="ql-serif"
            style={{ fontSize: '15px', fontStyle: 'italic', color: 'var(--muted)' }}
          >
            — your editor
          </p>

          <button
            onClick={dismiss}
            className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-[--accent] rounded-sm px-4 py-2"
            style={{
              fontSize: '9px',
              letterSpacing: '0.18em',
              color: 'var(--bg)',
              background: 'var(--accent)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Open today's issue →
          </button>
        </div>
      </div>
    </div>
  );
}
