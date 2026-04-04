'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { FeedResponse } from '@/lib/types/article';
import { initDeviceId } from '@/lib/identity/device';
import { runMigrationIfNeeded, loadFromServer, drainQueue } from '@/lib/feedback/store';
import AccountIcon from './components/AccountIcon';
import ArticleCard from './components/ArticleCard';
import FeedSkeleton from './components/FeedSkeleton';
import ErrorState from './components/ErrorState';
import BatchLabel from './components/BatchLabel';

type Status = 'loading' | 'success' | 'error';

export default function FeedPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<FeedResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Daily Digest</h1>
          <AccountIcon />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {status === 'loading' && <FeedSkeleton />}

        {status === 'error' && (
          <ErrorState
            message={errorMessage ?? 'Something went wrong.'}
            onRetry={fetchFeed}
          />
        )}

        {status === 'success' && data && (
          <>
            <BatchLabel batchDate={data.batchDate} />
            {data.articles.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-12">
                No articles available yet. Check back soon.
              </p>
            ) : (
              <div className="space-y-3">
                {data.articles.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    onClick={() => router.push(`/articles/${article.id}`)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
