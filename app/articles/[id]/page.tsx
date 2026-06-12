import { notFound } from 'next/navigation';
import Link from 'next/link';
import { findArticleAcrossBatches } from '@/lib/pipeline/storage';
import ArticleInteractions from '@/app/components/ArticleInteractions';
import ArticleBodyClient from '@/app/components/ArticleBodyClient';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pos?: string; total?: string }>;
}

function folioStr(n: number): string {
  return `№\u00A0${String(n).padStart(2, '0')}`;
}

/** Decode common named HTML entities left over in stored body text. */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&ldquo;/g, '\u201C')
    .replace(/&rdquo;/g, '\u201D')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Strip trailing RSS boilerplate from body text paragraphs. */
function cleanBodyText(text: string): string {
  return text
    .replace(/\s*The post .+? (?:first )?appeared on .+?\.\s*$/im, '')
    .replace(/\s*first appeared on .+?\.\s*$/im, '')
    .trim();
}

export default async function ArticlePage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const found = await findArticleAcrossBatches(id);

  if (!found) notFound();

  const { article, index: articleIndex, total: batchTotal } = found;

  // Use pos/total from feed URL params (reflect displayed issue order),
  // falling back to the article's position in its own batch
  const folio = sp.pos ? parseInt(sp.pos, 10) : articleIndex + 1;
  const total = sp.total ? parseInt(sp.total, 10) : batchTotal;

  const publishedDate = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(article.publishedAt));

  const bodyText = article.bodyText
    ? decodeHtmlEntities(cleanBodyText(article.bodyText))
    : null;

  const paragraphs = bodyText
    ? bodyText.split('\n').filter(Boolean)
    : [];

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
            className="ql-mono flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm py-2"
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
            className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm py-2"
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
              {/* Above the fold (likely LCP) — keep eager, but reserve the
                  box via aspect-ratio and decode off the main thread. */}
              <img
                src={article.imageUrl}
                alt=""
                className="w-full object-cover"
                decoding="async"
                style={{ aspectRatio: '16 / 9', maxHeight: '280px' }}
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
              {decodeHtmlEntities(article.description)}
            </p>
          )}

          <hr className="ql-rule mb-6" />

          {/* Feedback row */}
          <div className="mb-8">
            <ArticleInteractions articleId={article.id} />
          </div>

          {/* Body — client component handles position tracking */}
          {paragraphs.length > 0 ? (
            <ArticleBodyClient
              articleId={article.id}
              paragraphs={paragraphs}
            />
          ) : bodyText ? (
            <div
              className="ql-serif"
              style={{ fontSize: '18px', lineHeight: 1.7, color: 'var(--fg)' }}
            >
              {bodyText.split('\n').filter(Boolean).map((para, i) => (
                <p key={i} style={{ marginBottom: '1.2em' }}>{para}</p>
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
              className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm py-2"
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
