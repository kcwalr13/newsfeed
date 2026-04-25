import { notFound } from 'next/navigation';
import Link from 'next/link';
import { readBatch, readLatestBatch } from '@/lib/pipeline/storage';
import ArticleInteractions from '@/app/components/ArticleInteractions';

interface Props {
  params: Promise<{ id: string }>;
}

function folioStr(n: number): string {
  return `№\u00A0${String(n).padStart(2, '0')}`;
}

export default async function ArticlePage({ params }: Props) {
  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);
  const batch = (await readBatch(today)) ?? (await readLatestBatch());

  if (!batch) notFound();

  const articleIndex = batch.articles.findIndex((a) => a.id === id);
  if (articleIndex === -1) notFound();
  const article = batch.articles[articleIndex];
  const folio = articleIndex + 1;
  const total = batch.articles.length;

  const publishedDate = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(article.publishedAt));

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Reader header */}
      <header
        className="sticky top-0 z-10"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--rule)' }}
      >
        <div className="max-w-2xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="ql-mono flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[--accent] rounded-sm py-2"
            style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.14em', textDecoration: 'none' }}
          >
            ← Back
          </Link>

          <span
            className="ql-mono"
            style={{ fontSize: '9px', color: 'var(--dim)', letterSpacing: '0.14em' }}
          >
            {folioStr(folio)} of {total}
          </span>

          <a
            href={article.articleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-[--accent] rounded-sm py-2"
            style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.14em', textDecoration: 'none' }}
          >
            Source ↗
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5">
        <div className="pt-8 pb-6">
          {/* Meta */}
          <p
            className="ql-mono mb-4"
            style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.14em' }}
          >
            {article.sourceName.toUpperCase()} · {publishedDate.toUpperCase()}
          </p>

          {/* Hero image (duotone) */}
          {article.imageUrl && (
            <div
              className="ql-duotone-wrapper rounded-sm overflow-hidden mb-6"
              style={{ maxHeight: '280px' }}
            >
              <img
                src={article.imageUrl}
                alt=""
                className="w-full object-cover"
                style={{ maxHeight: '280px' }}
              />
              <div className="ql-duotone-shadow" />
              <div className="ql-duotone-highlight" />
            </div>
          )}

          {/* Title */}
          <h1
            className="ql-serif"
            style={{
              fontSize: '30px',
              fontStyle: 'italic',
              fontWeight: 500,
              lineHeight: 1.25,
              color: 'var(--fg)',
              marginBottom: '20px',
            }}
          >
            {article.title}
          </h1>

          {/* Description / excerpt */}
          {article.description && (
            <p
              className="ql-serif"
              style={{
                fontSize: '18px',
                fontStyle: 'italic',
                color: 'var(--muted)',
                lineHeight: 1.55,
                marginBottom: '24px',
                borderLeft: '2px solid var(--rule)',
                paddingLeft: '16px',
              }}
            >
              {article.description}
            </p>
          )}

          <hr className="ql-rule mb-6" />

          {/* Feedback row inline */}
          <div className="mb-8">
            <ArticleInteractions articleId={article.id} />
          </div>

          {/* Body */}
          {article.bodyText ? (
            <div
              className="ql-serif"
              style={{ fontSize: '18px', lineHeight: 1.7, color: 'var(--fg)' }}
            >
              {article.bodyText.split('\n').filter(Boolean).map((para, i) => (
                <p key={i} style={{ marginBottom: '1.2em' }}>
                  {para}
                </p>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p
                className="ql-serif"
                style={{ fontSize: '17px', fontStyle: 'italic', color: 'var(--muted)', marginBottom: '12px' }}
              >
                Full text not available here.
              </p>
              <a
                href={article.articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ql-mono"
                style={{ fontSize: '9px', color: 'var(--accent)', letterSpacing: '0.14em', textDecoration: 'none' }}
              >
                Read at {article.sourceName} ↗
              </a>
            </div>
          )}

          {/* End of article */}
          <hr className="ql-rule mt-8 mb-6" />
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-[--accent] rounded-sm py-2"
              style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.14em', textDecoration: 'none' }}
            >
              ← Back to issue
            </Link>
            <a
              href={article.articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ql-mono"
              style={{ fontSize: '9px', color: 'var(--accent)', letterSpacing: '0.14em', textDecoration: 'none' }}
            >
              Full source ↗
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
