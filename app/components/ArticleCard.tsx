'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Article, ContentType } from '@/lib/types/article';
import { SLOT_LABELS, isLinkOutItem } from '@/lib/types/article';
import { getFeedback, setFeedback, clearFeedback } from '@/lib/feedback/store';

interface Props {
  article: Article;
  folio: number; // 1-based position in the issue
  /** Destination for the card's navigation regions (image, title, excerpt). */
  href: string;
  onFeedbackChange?: (articleId: string, value: string | null) => void;
  /**
   * Fired when one of the card's navigation regions is clicked (R5-A1). The feed
   * records the clicked article + scroll position so back-navigation can restore it.
   */
  onNavigate?: () => void;
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

// Per-type kicker + call-to-action for link-out items (R7-2). Each links
// STRAIGHT OUT (never the in-app reader). `website` covers the R5 curated
// `place` (its "A place to get lost in" copy is preserved). Richer per-type
// media (cover art, duration) arrives in R7-4.
const LINK_OUT_META: Record<Exclude<ContentType, 'article'>, { kicker: string; cta: string }> = {
  website: { kicker: 'A place to get lost in',  cta: 'Explore ↗' },
  thread:  { kicker: 'A thread worth following', cta: 'Read the thread ↗' },
  music:   { kicker: 'Something to hear',        cta: 'Listen ↗' },
  video:   { kicker: 'Something to watch',       cta: 'Watch ↗' },
  find:    { kicker: 'A curious find',           cta: 'Check it out ↗' },
};

function folioStr(n: number): string {
  return `№\u00A0${String(n).padStart(2, '0')}`;
}

export default function ArticleCard({ article, folio, href, onFeedbackChange, onNavigate }: Props) {
  const [feedback, setFeedbackState] = useState<Verb>(
    () => getFeedback(article.id) ?? null
  );
  const [confirmed, setConfirmed] = useState<Verb>(null);
  // Broken image URL → fall back to the drop-cap folio instead of an empty
  // duotone box (R2-26).
  const [imageError, setImageError] = useState(false);

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

  // Content-format card variants (R5-D2): a compact card for short/potpourri
  // (no hero — they're quick), an image-forward card for visual (taller hero).
  // longread/place/undefined keep the default treatment (place gets its own
  // card in D3). A small format tag in the meta row signals the variety.
  const isVisual = article.format === 'visual';
  const isCompact = article.format === 'short' || article.format === 'potpourri';
  // A link-out item — any non-`article` contentType, or the R5 curated `place`.
  // It links STRAIGHT OUT (no in-app reader); the type picks the kicker + CTA.
  const isLinkOut = isLinkOutItem(article);
  const linkOutType: Exclude<ContentType, 'article'> =
    article.contentType && article.contentType !== 'article' ? article.contentType : 'website';
  const formatTag =
    article.format === 'visual' ? 'Visual'
    : article.format === 'short' ? 'Short'
    : article.format === 'potpourri' ? 'Miscellany'
    : null;
  const heroMaxHeight = isVisual ? 320 : 220;

  // Link-out item (R7-2): a one-off find — a whole site to wander, a thread, a
  // track. It has no body, so it links STRAIGHT OUT (new tab) rather than opening
  // the in-app reader, with a per-type kicker + CTA. The standard feedback row
  // (dislike/like/save) is added in R7-2d so these gems are rateable.
  if (isLinkOut) {
    const meta = LINK_OUT_META[linkOutType];
    const blurb = article.curatorNote ?? cleanDesc(article.description ?? '');
    return (
      <article className="relative" data-article-id={article.id}>
        <hr className="ql-rule mb-0" />
        <div className="pt-5 pb-6">
          <div className="flex items-baseline gap-4 mb-3">
            <span className="ql-folio">{folioStr(folio)}</span>
            <span
              className="ql-mono"
              style={{ fontSize: '9px', color: 'var(--accent)', letterSpacing: '0.18em', textTransform: 'uppercase' }}
            >
              {meta.kicker}
            </span>
          </div>
          <a
            href={article.articleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
            style={{ textDecoration: 'none' }}
            aria-label={`${article.title} (opens in a new tab)`}
          >
            <div
              className="rounded-sm"
              style={{ background: 'var(--accent-soft)', padding: '20px', border: '1px solid var(--rule)' }}
            >
              <h2
                className="ql-serif"
                style={{ fontSize: '22px', fontStyle: 'italic', fontWeight: 500, lineHeight: 1.3, color: 'var(--fg)', marginBottom: '8px' }}
              >
                {article.title}
              </h2>
              {blurb && (
                <p
                  className="ql-serif"
                  style={{ fontSize: '16px', fontStyle: 'italic', color: 'var(--muted)', lineHeight: 1.55, marginBottom: '14px' }}
                >
                  {blurb}
                </p>
              )}
              <span
                className="ql-mono"
                style={{ fontSize: '10px', color: 'var(--accent)', letterSpacing: '0.16em', textTransform: 'uppercase' }}
              >
                {meta.cta}
              </span>
            </div>
          </a>
        </div>
      </article>
    );
  }

  return (
    <article className="relative" data-article-id={article.id}>
      {/* Hairline rule above each card */}
      <hr className="ql-rule mb-0" />

      <div className={isCompact ? 'pt-4 pb-5' : 'pt-5 pb-6'}>
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
          {(formatTag || readTimeStr) && (
            <span
              className="ql-mono"
              style={{ fontSize: '9px', color: 'var(--dim)', letterSpacing: '0.12em' }}
            >
              {formatTag && (
                <span style={{ color: 'var(--muted)', textTransform: 'uppercase' }}>{formatTag}</span>
              )}
              {formatTag && readTimeStr && ' · '}
              {readTimeStr}
            </span>
          )}
        </div>

        {/* Hero image (duotone) OR drop-cap folio (also the fallback if the
            image fails to load). Suppressed for the compact short/potpourri
            variant; taller for the image-forward visual variant (R5-D2). */}
        {!isCompact && (article.imageUrl && !imageError ? (
          <Link
            href={href}
            onClick={onNavigate}
            className="w-full block mb-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
            aria-label={`Read: ${article.title}`}
          >
            <div className="ql-duotone-wrapper rounded-sm overflow-hidden" style={{ maxHeight: `${heroMaxHeight}px` }}>
              {/* aspect-ratio reserves the slot before the image loads (no
                  layout shift); the Article type carries no dimensions, so a
                  fixed editorial ratio stands in. */}
              <img
                src={article.imageUrl}
                alt=""
                className="w-full object-cover"
                loading="lazy"
                decoding="async"
                onError={() => setImageError(true)}
                style={{ aspectRatio: '16 / 9', maxHeight: `${heroMaxHeight}px` }}
              />
              <div className="ql-duotone-shadow" />
              <div className="ql-duotone-highlight" />
            </div>
          </Link>
        ) : (
          <Link
            href={href}
            onClick={onNavigate}
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
        ))}

        {/* Slot badge (footnote dagger inline with title, caption below meta).
            The per-slot rationale sentence is gone — the curator note below now
            carries the "why this" for every piece, slotted or not (R5-C2). */}
        {slotInfo && (
          <p className="ql-slot-caption mb-2" style={{ color: 'var(--accent)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase', marginRight: '6px' }}>
              {slotInfo.glyph} {slotInfo.label}
            </span>
            <span style={{ color: 'var(--muted)' }}>— {slotInfo.caption}</span>
          </p>
        )}

        {/* Title */}
        <Link
          href={href}
          onClick={onNavigate}
          className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
          style={{ textDecoration: 'none' }}
        >
          <h2
            className="ql-serif"
            style={{
              fontSize: isCompact ? '19px' : '22px',
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
          {/* Blurb: the personalized curator note (R5-C) replaces the raw RSS
              summary; fall back to the cleaned description when no note exists. */}
          {(article.curatorNote || article.description) && (
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
              {article.curatorNote ?? cleanDesc(article.description ?? '')}
            </p>
          )}
        </Link>

        {/* Feedback row: Pass / Underline / Read later */}
        <div className="mt-5">
          <div
            role="radiogroup"
            aria-label="Your response to this piece"
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
                  role="radio"
                  aria-checked={isActive}
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
