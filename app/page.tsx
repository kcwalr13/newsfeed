'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Article, FeedResponse } from '@/lib/types/article';
import { initDeviceId } from '@/lib/identity/device';
import { runMigrationIfNeeded, loadFromServer, drainQueue, getFeedback } from '@/lib/feedback/store';
import ArticleCard from './components/ArticleCard';
import EditorLetterModal from './components/EditorLetterModal';

type Status = 'loading' | 'success' | 'error';

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
  const router = useRouter();
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<FeedResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchFeed = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/feed/today');
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const json: FeedResponse = await res.json();
      setData(json);
      setStatus('success');
    } catch {
      setErrorMessage('Could not load your digest. Please check your connection.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

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
      await loadFromServer();
    }

    void initFeedback();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/feed/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
      await fetchFeed();
    } catch {
      // silently ignore refresh errors — feed still shows
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchFeed]);

  const total = data?.articles.length ?? 7;
  const read = data ? countRead(data.articles) : 0;
  const remaining = total - read;

  // Format today's date in editorial style
  const today = new Date();
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  return (
    <>
      <EditorLetterModal />

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
                style={{ fontSize: '9px', color: 'var(--accent)', letterSpacing: '0.14em', background: 'none', border: 'none', cursor: 'pointer' }}
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
              {data.articles.length === 0 ? (
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
                    style={{ fontSize: '9px', color: 'var(--accent)', letterSpacing: '0.14em', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    {isRefreshing ? 'Working…' : 'Run pipeline'}
                  </button>
                </div>
              ) : (
                <div>
                  {data.articles.map((article, index) => (
                    <ArticleCard
                      key={article.id}
                      article={article}
                      folio={index + 1}
                      onClick={() => router.push(`/articles/${article.id}`)}
                    />
                  ))}

                  {/* End-of-feed rule + footer */}
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
                      className="ql-mono inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-[--accent] rounded-sm"
                      style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.14em', textDecoration: 'none' }}
                    >
                      Past issues &amp; shelf →
                    </Link>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </>
  );
}
