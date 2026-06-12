'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

function cleanDesc(text: string): string {
  return text
    .replace(/\s*The post .+? (?:first )?appeared (?:first )?on .+?\.\s*$/im, '')
    .replace(/\s*first appeared on .+?\.\s*$/im, '')
    .replace(/\s*(Continue reading|Read more)[^.]*[\.\u2026]?\s*$/i, '')
    .trim();
}
import { getAllFeedback } from '@/lib/feedback/store';
import { localTodayString } from '@/lib/utils/localDate';
import type { BatchSummary } from '@/app/api/archive/route';

type Tab = 'issues' | 'shelf';

function SevenDotMini({ total, read }: { total: number; read: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: i < read ? 'var(--accent)' : 'var(--dim)',
            opacity: i < read ? 1 : 0.4,
          }}
        />
      ))}
    </div>
  );
}

function formatDate(dateStr: string): { weekday: string; short: string } {
  const d = new Date(dateStr + 'T12:00:00');
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
    short:   d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

function daysAgo(dateStr: string): string {
  // Anchor both sides at NOON: a bare YYYY-MM-DD parses as UTC midnight, so
  // floor-based day math drifts by one west of UTC / across DST (FE-M5).
  const then = new Date(`${dateStr}T12:00:00`);
  const todayNoon = new Date(`${localTodayString()}T12:00:00`);
  const diff = Math.round((todayNoon.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'today';
  if (diff === 1) return '1 day ago';
  return `${diff} days ago`;
}

export default function ArchivePage() {
  const [tab,      setTab]      = useState<Tab>('issues');
  const [batches,  setBatches]  = useState<BatchSummary[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  // Network/server failure must not render as "No past issues yet." (FE-M6)
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const archiveAbortRef = useRef<AbortController | null>(null);

  const loadArchive = useCallback(() => {
    archiveAbortRef.current?.abort();
    const controller = new AbortController();
    archiveAbortRef.current = controller;
    setLoading(true);
    setErrorMessage(null);
    fetch('/api/archive', { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Server error (${r.status})`);
        return r.json();
      })
      .then((data: BatchSummary[]) => {
        setBatches(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return; // superseded or unmounted
        const offline = typeof navigator !== 'undefined' && !navigator.onLine;
        const network = err instanceof TypeError; // fetch rejects with TypeError on network failure
        setErrorMessage(
          offline || network
            ? 'Could not reach the archive. Check your connection and try again.'
            : 'The archive could not be loaded right now. Please try again.'
        );
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const fb = getAllFeedback();
    const map: Record<string, string> = {};
    for (const [id, rec] of Object.entries(fb)) map[id] = rec.value;
    // localStorage is only readable after mount; seeded once here
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFeedback(map);

    loadArchive();
    return () => archiveAbortRef.current?.abort();
  }, [loadArchive]);

  // Shelf: all articles across all batches with feedback === 'save'
  const shelfItems = batches.flatMap((b) =>
    b.articles
      .filter((a) => feedback[a.id] === 'save')
      .map((a) => ({ ...a, batchDate: b.batchDate }))
  );

  const today = localTodayString();

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-10"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--rule)' }}
      >
        <div className="max-w-2xl mx-auto px-5 py-3 flex items-center justify-between">
          <Link
            href="/"
            className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm py-2"
            style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.14em', textDecoration: 'none' }}
          >
            ← Issue
          </Link>
          <h1
            className="ql-serif"
            style={{ fontSize: '18px', fontStyle: 'italic', fontWeight: 500, color: 'var(--fg)' }}
          >
            Archive
          </h1>
          <div style={{ width: '48px' }} /> {/* spacer */}
        </div>

        {/* Tab strip */}
        <div
          className="max-w-2xl mx-auto px-5 flex"
          style={{ borderTop: '1px solid var(--rule)' }}
        >
          {(['issues', 'shelf'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
              style={{
                fontSize: '9px',
                letterSpacing: '0.18em',
                padding: '10px 20px 10px 0',
                color: tab === t ? 'var(--fg)' : 'var(--dim)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                borderBottom: tab === t ? `2px solid var(--accent)` : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5">
        {loading && (
          <div className="animate-pulse space-y-4 pt-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i}>
                <hr className="ql-rule" />
                <div className="py-4 flex justify-between">
                  <div className="space-y-2">
                    <div className="h-3 w-16 rounded" style={{ background: 'var(--dim)', opacity: 0.3 }} />
                    <div className="h-4 w-32 rounded" style={{ background: 'var(--dim)', opacity: 0.2 }} />
                  </div>
                  <div className="flex gap-1">
                    {[1,2,3,4,5,6,7].map(j => (
                      <div key={j} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--dim)', opacity: 0.2 }} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ERROR STATE */}
        {!loading && errorMessage && (
          <div className="py-16 text-center">
            <p
              className="ql-serif"
              style={{ fontSize: '18px', fontStyle: 'italic', color: 'var(--muted)', marginBottom: '16px' }}
            >
              {errorMessage}
            </p>
            <button
              onClick={loadArchive}
              className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
              style={{ fontSize: '9px', color: 'var(--accent)', letterSpacing: '0.14em', background: 'none', border: 'none', cursor: 'pointer', minHeight: '44px', padding: '12px 16px' }}
            >
              TRY AGAIN
            </button>
          </div>
        )}

        {/* ISSUES TAB */}
        {!loading && !errorMessage && tab === 'issues' && (
          <>
            {batches.length === 0 ? (
              <div className="py-16 text-center">
                <p className="ql-serif" style={{ fontSize: '18px', fontStyle: 'italic', color: 'var(--muted)' }}>
                  No past issues yet.
                </p>
              </div>
            ) : (
              <div>
                {batches.map((batch, idx) => {
                  const isToday = batch.batchDate === today;
                  const readCount = batch.articles.filter(a =>
                    feedback[a.id] === 'like' || feedback[a.id] === 'save'
                  ).length;
                  const total = batch.articles.length;
                  const { weekday, short } = formatDate(batch.batchDate);

                  return (
                    <div key={batch.batchDate}>
                      <hr className="ql-rule" />
                      <div
                        className="py-4"
                        style={isToday ? { background: 'var(--accent-soft)', margin: '0 -20px', padding: '16px 20px' } : undefined}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-3 mb-1">
                              <span
                                className="ql-mono"
                                style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.18em' }}
                              >
                                {isToday ? 'TODAY' : weekday.toUpperCase().slice(0, 3)}
                              </span>
                              <span
                                className="ql-mono"
                                style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.14em' }}
                              >
                                {short.toUpperCase()}
                              </span>
                              {isToday && (
                                <span
                                  className="ql-mono"
                                  style={{ fontSize: '8px', color: 'var(--accent)', letterSpacing: '0.14em' }}
                                >
                                  CURRENT
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 mt-2">
                              <SevenDotMini total={total} read={readCount} />
                              <span
                                className="ql-mono"
                                style={{ fontSize: '8px', color: 'var(--muted)', letterSpacing: '0.12em' }}
                              >
                                {readCount}/{total} READ
                              </span>
                            </div>
                          </div>

                          {isToday && (
                            <Link
                              href="/"
                              className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
                              style={{ fontSize: '8px', color: 'var(--accent)', letterSpacing: '0.14em', textDecoration: 'none', whiteSpace: 'nowrap' }}
                            >
                              Open →
                            </Link>
                          )}
                        </div>
                      </div>
                      {idx === batches.length - 1 && (
                        <hr className="ql-rule" />
                      )}
                    </div>
                  );
                })}

                {/* In the stacks footer */}
                {batches.length > 5 && (
                  <p
                    className="ql-serif py-6 text-center"
                    style={{ fontSize: '14px', fontStyle: 'italic', color: 'var(--dim)' }}
                  >
                    Earliest issues are held in the stacks.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* SHELF TAB */}
        {!loading && !errorMessage && tab === 'shelf' && (
          <>
            {shelfItems.length === 0 ? (
              <div className="py-16 text-center">
                <p
                  className="ql-serif"
                  style={{ fontSize: '18px', fontStyle: 'italic', color: 'var(--muted)', marginBottom: '8px' }}
                >
                  Your shelf is empty.
                </p>
                <p
                  className="ql-serif"
                  style={{ fontSize: '15px', fontStyle: 'italic', color: 'var(--dim)' }}
                >
                  Mark pieces &ldquo;Read later&rdquo; from any issue and they&rsquo;ll appear here.
                </p>
              </div>
            ) : (
              <div>
                <div className="pt-5 pb-2">
                  <p
                    className="ql-mono"
                    style={{ fontSize: '9px', color: 'var(--dim)', letterSpacing: '0.14em' }}
                  >
                    {shelfItems.length} PIECE{shelfItems.length !== 1 ? 'S' : ''} SAVED
                  </p>
                </div>

                {shelfItems.map((item) => (
                  <div key={item.id}>
                    <hr className="ql-rule" />
                    <div className="py-4">
                      <div className="flex items-baseline justify-between gap-4 mb-2">
                        <span
                          className="ql-mono"
                          style={{ fontSize: '8px', color: 'var(--muted)', letterSpacing: '0.14em' }}
                        >
                          {item.sourceName.toUpperCase()}
                        </span>
                        <span
                          className="ql-mono"
                          style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.12em', whiteSpace: 'nowrap' }}
                        >
                          {daysAgo(item.batchDate).toUpperCase()}
                        </span>
                      </div>

                      <Link
                        href={`/articles/${item.id}`}
                        className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
                        style={{ textDecoration: 'none' }}
                      >
                        <h3
                          className="ql-serif"
                          style={{ fontSize: '19px', fontStyle: 'italic', fontWeight: 500, color: 'var(--fg)', lineHeight: 1.3 }}
                        >
                          {item.title}
                        </h3>
                        {item.description && (
                          <p
                            className="ql-serif mt-1"
                            style={{
                              fontSize: '15px',
                              fontStyle: 'italic',
                              color: 'var(--muted)',
                              lineHeight: 1.5,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {cleanDesc(item.description)}
                          </p>
                        )}
                      </Link>
                    </div>
                  </div>
                ))}

                <hr className="ql-rule" />
                <p
                  className="ql-serif py-6 text-center"
                  style={{ fontSize: '14px', fontStyle: 'italic', color: 'var(--dim)' }}
                >
                  Finish a shelved piece to remove it.
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
