import { notFound } from 'next/navigation';
import Link from 'next/link';
import { readBatch, readLatestBatch } from '@/lib/pipeline/storage';
import ViewSourceLink from '@/app/components/ViewSourceLink';
import FeedbackButtons from '@/app/components/FeedbackButtons';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ArticlePage({ params }: Props) {
  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);
  const batch = readBatch(today) ?? readLatestBatch();

  if (!batch) notFound();

  const article = batch.articles.find((a) => a.id === id);
  if (!article) notFound();

  const publishedDate = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(article.publishedAt));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors min-h-[44px] py-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to feed
          </Link>
          <ViewSourceLink articleUrl={article.articleUrl} sourceName={article.sourceName} />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
          {article.sourceName} · {publishedDate}
        </p>

        <h1 className="text-2xl font-bold text-gray-900 leading-snug mb-4">
          {article.title}
        </h1>

        <div className="mb-6">
          <FeedbackButtons articleId={article.id} />
        </div>

        {article.bodyText ? (
          <div className="text-base text-gray-700 leading-relaxed space-y-4">
            {article.bodyText.split('\n').filter(Boolean).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">
            Full text not available — view the original source.
          </p>
        )}
      </main>
    </div>
  );
}
