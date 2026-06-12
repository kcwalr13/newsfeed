'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import type { Article, FeedResponse } from '@/lib/types/article';
import { initDeviceId } from '@/lib/identity/device';
import { runMigrationIfNeeded, loadFromServer, drainQueue, getFeedback } from '@/lib/feedback/store';
import ArticleCard from './components/ArticleCard';
import EditorLetterModal from './components/EditorLetterModal';
import IssueCover from './components/IssueCover';
import Colophon from './components/Colophon';
import type { DailyIssue } from '@/lib/types/article';

type Status = 'loading' | 'success' | 'error';
type IssueMetaStatus = 'idle' | 'loading' | 'ready';

function SevenDotStrip({ total, read }: { total: number; read: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`ql-dot${i < read ? ' filled' : ''}`}
        />
      ))}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="animate-pulse space-y-8 mt-8">
      {[1, 2, 3].map((i) => (
        <div key={i}>
          <hr className="ql-rule mb-0" />
          <div className="pt-5 pb-6 space-y-3">
            <div className="flex gap-4">
              <div className="h-3 w-8 rounded" style={{ background: 'var(--dim)', opacity: 0.3 }} />
              <div className="h-3 w-24 rounded" style={{ background: 'var(--dim)', opacity: 0.3 }} />
            </div>
            <div className="h-28 rounded" style={{ background: 'var(--dim)', opacity: 0.15 }} />
            <div className="h-6 w-3/4 rounded" style={{ background: 'var(--dim)', opacity: 0.2 }} />
            <div className="h-4 w-full rounded" style={{ background: 'var(--dim)', opacity: 0.12 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function countRead(articles: Article[]): number {
  return articles.filter((a) => {
    const fb = getFeedback(a.id);
    return fb === 'like' || fb === 'save';
  }).length;
}

export default function FeedPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<FeedResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Track feedback state locally so the seven-dot strip updates live
  const [feedbackSnapshot, setFeedbackSnapshot] = useState<Record<string, string>>({});
  // True once server feedback has merged into localStorage (loadFromServer) —
  // seeding the dot strip before that reads stale/empty local state on a new
  // device (FE-M3).
  const [feedbackReady, setFeedbackReady] = useState(false);
  // Issue metadata for cover + colophon
  const [issueMeta, setIssueMeta] = useState<DailyIssue | null>(null);
  const [issueMetaStatus, setIssueMetaStatus] = useState<IssueMetaStatus>('idle');

  // Abort in-flight requests when superseded or on unmount so a slow stale
  // response can't race a newer one into state (FE-M9).
  const feedAbortRef = useRef<AbortController | null>(null);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const metaAbortRef = useRef<AbortController | null>(null);

  const fetchFeed = useCallback(async () => {
    feedAbortRef.current?.abort();
    const controller = new AbortController();
    feedAbortRef.current = controller;
    setStatus('loading');
    try {
      const res = await fetch('/api/feed/today', { signal: controller.signal });
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const json: FeedResponse = await res.json();
      setData(json);
      setStatus('success');
    } catch {
      if (controller.signal.aborted) return; // superseded or unmounted
      setErrorMessage('Could not load your digest. Please check your connection.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    fetchFeed();
    return () => feedAbortRef.current?.abort();
  }, [fetchFeed]);

  // Unmount-only abort for the refresh + issue-meta requests
  useEffect(
    () => () => {
      refreshAbortRef.current?.abort();
      metaAbortRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void drainQueue();
    };
    const handleFocus = () => void drainQueue();

    async function initFeedback() {
      initDeviceId();
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleFocus);
      await runMigrationIfNeeded();
      await loadFromServer(); // falls back to localStorage on error — always resolves
      setFeedbackReady(true);
    }

    void initFeedback();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/feed/refresh', { method: 'POST', signal: controller.signal });
      if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
      await fetchFeed();
    } catch {
      // silently ignore refresh errors — feed still shows
    } finally {
      if (!controller.signal.aborted) setIsRefreshing(false);
    }
  }, [fetchFeed]);

  // Seed feedback snapshot once data AND the server feedback merge are ready
  useEffect(() => {
    if (data && feedbackReady) {
      const fb: Record<string, string> = {};
      for (const a of data.articles) {
        const v = getFeedback(a.id);
        if (v) fb[a.id] = v;
      }
      setFeedbackSnapshot(fb);
    }
  }, [data, feedbackReady]);

  // Fetch issue metadata once feed data is ready
  useEffect(() => {
    if (status !== 'success' || issueMetaStatus !== 'idle') return;
    setIssueMetaStatus('loading');
    const controller = new AbortController();
    metaAbortRef.current = controller;
    void (async () => {
      try {
        const res = await fetch('/api/issue/meta', { signal: controller.signal });
        if (res.ok) {
          const meta = (await res.json()) as DailyIssue;
          setIssueMeta(meta);
        }
      } catch { /* non-blocking */ } finally {
        if (!controller.signal.aborted) setIssueMetaStatus('ready');
      }
    })();
  }, [status, issueMetaStatus]);

  // Show at most 7 articles ("seven a day" ritual) — the pipeline may return more candidates
  const ISSUE_SIZE = 7;
  const displayArticles = data ? data.articles.slice(0, ISSUE_SIZE) : [];
  const total = displayArticles.length || ISSUE_SIZE;
  const read = displayArticles.filter(a => feedbackSnapshot[a.id] === 'like' || feedbackSnapshot[a.id] === 'save').length;
  const remaining = total - read;

  const handleFeedbackChange = useCallback((articleId: string, value: string | null) => {
    setFeedbackSnapshot(prev => {
      const next = { ...prev };
      if (value === null) {
        delete next[articleId];
      } else {
        next[articleId] = value;
      }
      return next;
    });
  }, []);

  // Format today's date in editorial style
  const today = new Date();
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  return (
    <>
      <EditorLetterModal />
      {issueMeta && <IssueCover issue={issueMeta} />}

      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        {/* Masthead */}
        <header
          className="sticky top-0 z-10"
          style={{ background: 'var(--bg)', borderBottom: '1px solid var(--rule)' }}
        >
          <div className="max-w-2xl mx-auto px-5 py-3 flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <h1
                className="ql-serif"
                style={{ fontSize: '20px', fontStyle: 'italic', fontWeight: 500, color: 'var(--fg)' }}
              >
                Tangent
              </h1>
              <span
                className="ql-mono hidden sm:inline"
                style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.18em' }}
              >
                Quiet Library
              </span>
            </div>

            {/* Seven-dot strip */}
            {status === 'success' && data && (
              <div className="flex items-center gap-3">
                <SevenDotStrip total={total} read={read} />
                <span
                  className="ql-mono"
                  style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.14em' }}
                >
                  {read}/{total}
                </span>
              </div>
            )}
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-5">
          {status === 'loading' && <FeedSkeleton />}

          {status === 'error' && (
            <div className="py-16 text-center">
              <p
                className="ql-serif"
                style={{ fontSize: '18px', fontStyle: 'italic', color: 'var(--muted)', marginBottom: '16px' }}
              >
                {errorMessage ?? 'Something went wrong.'}
              </p>
              <button
                onClick={fetchFeed}
                className="ql-mono"
                style={{ fontSize: '9px', color: 'var(--accent)', letterSpacing: '0.14em', background: 'none', border: 'none', cursor: 'pointer', minHeight: '44px', padding: '12px 16px' }}
              >
                Try again
              </button>
            </div>
          )}

          {status === 'success' && data && (
            <>
              {/* Issue header */}
              <div className="pt-8 pb-5">
                <p
                  className="ql-mono mb-2"
                  style={{ fontSize: '9px', color: 'var(--dim)', letterSpacing: '0.18em' }}
                >
                  {dayName.toUpperCase()}, {monthDay.toUpperCase()}
                </p>
                <p
                  className="ql-serif"
                  style={{ fontSize: '15px', fontStyle: 'italic', color: 'var(--muted)' }}
                >
                  {data.articles.length === 0
                    ? 'No pieces yet today.'
                    : remaining > 0
                    ? `${remaining} more to go.`
                    : `All ${total} pieces read. Well done.`}
                </p>
              </div>

              {/* Articles */}
              {displayArticles.length === 0 ? (
                <div className="py-16 text-center">
                  <p
                    className="ql-serif"
                    style={{ fontSize: '20px', fontStyle: 'italic', color: 'var(--muted)', marginBottom: '16px' }}
                  >
                    Nothing yet — check back soon.
                  </p>
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="ql-mono"
                    style={{ fontSize: '9px', color: 'var(--accent)', letterSpacing: '0.14em', background: 'none', border: 'none', cursor: 'pointer', minHeight: '44px', padding: '12px 16px' }}
                  >
                    {isRefreshing ? 'Working…' : 'Run pipeline'}
                  </button>
                </div>
              ) : (
                <div>
                  {displayArticles.map((article, index) => (
                    <ArticleCard
                      key={article.id}
                      article={article}
                      folio={index + 1}
                      href={`/articles/${article.id}?pos=${index + 1}&total=${displayArticles.length}`}
                      onFeedbackChange={handleFeedbackChange}
                    />
                  ))}

                  {/* End-of-feed summary */}
                  <hr className="ql-rule mt-0" />
                  <div className="py-8 text-center space-y-4">
                    <p
                      className="ql-serif"
                      style={{ fontSize: '18px', fontStyle: 'italic', color: 'var(--muted)' }}
                    >
                      {remaining > 0
                        ? `${remaining} piece${remaining !== 1 ? 's' : ''} to go.`
                        : "You\u2019ve reached the end of today\u2019s issue."}
                    </p>
                    <p
                      className="ql-mono"
                      style={{ fontSize: '9px', color: 'var(--dim)', letterSpacing: '0.14em' }}
                    >
                      Tomorrow&rsquo;s issue arrives in the morning.
                    </p>
                    <Link
                      href="/archive"
                      className="ql-mono inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
                      style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.14em', textDecoration: 'none' }}
                    >
                      Past issues &amp; shelf →
                    </Link>
                  </div>

                  {/* Colophon — shown when issue metadata is available */}
                  {issueMeta && <Colophon issue={issueMeta} />}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </>
  );
}
