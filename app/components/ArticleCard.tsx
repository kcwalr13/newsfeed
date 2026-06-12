'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Article } from '@/lib/types/article';
import { SLOT_LABELS } from '@/lib/types/article';
import { getFeedback, setFeedback, clearFeedback } from '@/lib/feedback/store';

interface Props {
  article: Article;
  folio: number; // 1-based position in the issue
  /** Destination for the card's navigation regions (image, title, excerpt). */
  href: string;
  onFeedbackChange?: (articleId: string, value: string | null) => void;
}

type Verb = 'like' | 'dislike' | 'save' | null;

/** Strip RSS boilerplate from descriptions before display. */
function cleanDesc(text: string): string {
  return text
    .replace(/\s*The post .+? (?:first )?appeared (?:first )?on .+?\.\s*$/im, '')
    .replace(/\s*first appeared on .+?\.\s*$/im, '')
    .replace(/\s*(Continue reading|Read more|Read the rest)[^.]*[\.\u2026]?\s*$/i, '')
    .replace(/\s*\[[\u2026\.]+\]\s*$/, '')
    .trim();
}

// Map feedback store values to design verbs
const VERB_META = {
  dislike: { verb: 'Pass',       desc: 'Not for me',      confirm: 'Noted. The next issue will reflect this.' },
  like:    { verb: 'Underline',  desc: 'This resonated',  confirm: 'Noted. More in this voice.' },
  save:    { verb: 'Read later', desc: 'Send to my shelf', confirm: 'Sent to your shelf.' },
} as const;

function folioStr(n: number): string {
  return `№\u00A0${String(n).padStart(2, '0')}`;
}

export default function ArticleCard({ article, folio, href, onFeedbackChange }: Props) {
  const [feedback, setFeedbackState] = useState<Verb>(
    () => getFeedback(article.id) ?? null
  );
  const [confirmed, setConfirmed] = useState<Verb>(null);

  function handleVerb(verb: 'like' | 'dislike' | 'save') {
    if (feedback === verb) {
      clearFeedback(article.id);
      setFeedbackState(null);
      setConfirmed(null);
      onFeedbackChange?.(article.id, null);
    } else {
      setFeedback(article.id, verb);
      setFeedbackState(verb);
      setConfirmed(verb);
      onFeedbackChange?.(article.id, verb);
    }
  }

  const slotInfo = article.explorationSlotType
    ? SLOT_LABELS[article.explorationSlotType]
    : null;

  const readTimeStr = article.readTime ? `${article.readTime} min` : null;

  return (
    <article className="relative">
      {/* Hairline rule above each card */}
      <hr className="ql-rule mb-0" />

      <div className="pt-5 pb-6">
        {/* Meta row: folio + source + read time */}
        <div className="flex items-baseline justify-between mb-3">
          <div className="flex items-baseline gap-4">
            <span className="ql-folio">{folioStr(folio)}</span>
            <span
              className="ql-mono"
              style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.14em' }}
            >
              {article.sourceName}
            </span>
          </div>
          {readTimeStr && (
            <span
              className="ql-mono"
              style={{ fontSize: '9px', color: 'var(--dim)', letterSpacing: '0.12em' }}
            >
              {readTimeStr}
            </span>
          )}
        </div>

        {/* Hero image (duotone) OR drop-cap folio */}
        {article.imageUrl ? (
          <Link
            href={href}
            className="w-full block mb-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
            aria-label={`Read: ${article.title}`}
          >
            <div className="ql-duotone-wrapper rounded-sm overflow-hidden" style={{ maxHeight: '220px' }}>
              {/* aspect-ratio reserves the slot before the image loads (no
                  layout shift); the Article type carries no dimensions, so a
                  fixed editorial ratio capped at 220px stands in. */}
              <img
                src={article.imageUrl}
                alt=""
                className="w-full object-cover"
                loading="lazy"
                decoding="async"
                style={{ aspectRatio: '16 / 9', maxHeight: '220px' }}
              />
              <div className="ql-duotone-shadow" />
              <div className="ql-duotone-highlight" />
            </div>
          </Link>
        ) : (
          <Link
            href={href}
            className="w-full block mb-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
            aria-label={`Read: ${article.title}`}
          >
            <div
              className="flex items-center justify-center rounded-sm"
              style={{ height: '80px', background: 'var(--accent-soft)' }}
            >
              <span
                className="ql-drop-cap select-none"
                style={{ fontSize: '64px', color: 'var(--dim)', opacity: 0.5 }}
              >
                {folioStr(folio)}
              </span>
            </div>
          </Link>
        )}

        {/* Slot badge (footnote dagger inline with title, caption below meta) */}
        {slotInfo && (
          <p className="ql-slot-caption mb-2" style={{ color: 'var(--accent)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase', marginRight: '6px' }}>
              {slotInfo.glyph} {slotInfo.label}
            </span>
            <span style={{ color: 'var(--muted)' }}>— {slotInfo.caption}</span>
            {article.rationale && (
              <span style={{ display: 'block', marginTop: '2px', color: 'var(--muted)', fontStyle: 'italic' }}>
                {article.rationale}
              </span>
            )}
          </p>
        )}

        {/* Title */}
        <Link
          href={href}
          className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
          style={{ textDecoration: 'none' }}
        >
          <h2
            className="ql-serif"
            style={{
              fontSize: '22px',
              fontStyle: 'italic',
              fontWeight: 500,
              lineHeight: 1.3,
              color: 'var(--fg)',
              marginBottom: '6px',
            }}
          >
            {article.title}
            {slotInfo && (
              <sup
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: '14px',
                  fontStyle: 'normal',
                  color: 'var(--accent)',
                  marginLeft: '3px',
                  verticalAlign: 'super',
                  lineHeight: 0,
                }}
              >
                †
              </sup>
            )}
          </h2>
          {article.description && (
            <p
              className="ql-serif"
              style={{
                fontSize: '16px',
                fontStyle: 'italic',
                color: 'var(--muted)',
                lineHeight: 1.5,
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {cleanDesc(article.description)}
            </p>
          )}
        </Link>

        {/* Feedback row: Pass / Underline / Read later */}
        <div className="mt-5">
          <div
            className="flex items-stretch justify-around"
            style={{ borderTop: '1px solid var(--rule)', paddingTop: '12px' }}
          >
            {(['dislike', 'like', 'save'] as const).map((verb) => {
              const meta = VERB_META[verb];
              const isActive = feedback === verb;
              return (
                <button
                  key={verb}
                  onClick={() => handleVerb(verb)}
                  aria-pressed={isActive}
                  className="ql-verb-btn flex-1 flex flex-col items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
                  style={isActive ? { color: 'var(--accent)' } : undefined}
                >
                  <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: '17px' }}>
                    {meta.verb}
                  </span>
                  <span className="ql-verb-label">{meta.desc}</span>
                </button>
              );
            })}
          </div>

          {/* Confirmation copy */}
          {confirmed && (
            <p
              className="ql-confirmation mt-3"
              style={{ fontSize: '13px', color: 'var(--muted)' }}
            >
              <em>{VERB_META[confirmed].confirm}</em>
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
