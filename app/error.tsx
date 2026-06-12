'use client';

import { useEffect } from 'react';

/**
 * Global error boundary (FE-M6). Differentiates being offline from a server
 * fault so the copy tells the reader what to actually do.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app/error]', error);
  }, [error]);

  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  return (
    <div
      className="min-h-screen flex items-center justify-center px-5"
      style={{ background: 'var(--bg)' }}
    >
      <div className="max-w-md w-full text-center py-16">
        <p
          className="ql-mono mb-6"
          style={{ fontSize: '9px', color: 'var(--dim)', letterSpacing: '0.2em' }}
        >
          TANGENT · {offline ? 'CONNECTION LOST' : 'PRESS TROUBLE'}
        </p>

        <hr className="ql-rule mb-8" />

        <h1
          className="ql-serif"
          style={{
            fontSize: '28px',
            fontStyle: 'italic',
            fontWeight: 500,
            lineHeight: 1.3,
            color: 'var(--fg)',
            marginBottom: '16px',
          }}
        >
          {offline
            ? 'The wire to the library has gone quiet.'
            : 'Something jammed in the presses.'}
        </h1>

        <p
          className="ql-serif"
          style={{
            fontSize: '16px',
            fontStyle: 'italic',
            color: 'var(--muted)',
            lineHeight: 1.6,
            marginBottom: '32px',
          }}
        >
          {offline
            ? 'You appear to be offline. Reconnect, then try again.'
            : 'An unexpected error interrupted this page. It has been noted — trying again usually clears it.'}
        </p>

        <hr className="ql-rule mb-8" />

        <button
          onClick={reset}
          className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
          style={{
            fontSize: '9px',
            color: 'var(--accent)',
            letterSpacing: '0.16em',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            minHeight: '44px',
            padding: '12px 16px',
          }}
        >
          TRY AGAIN
        </button>
      </div>
    </div>
  );
}
