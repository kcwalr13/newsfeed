'use client';

/**
 * Colophon
 *
 * Shown at the end of the feed after all seven articles.
 * Displays the issue's source credits in a traditional colophon style.
 */

import type { DailyIssue } from '@/lib/types/article';

interface Props {
  issue: DailyIssue;
}

export default function Colophon({ issue }: Props) {
  if (!issue.sources || issue.sources.length === 0) return null;

  return (
    <div
      className="py-12"
      style={{ borderTop: '1px solid var(--rule)' }}
    >
      {/* Colophon header */}
      <p
        className="ql-mono mb-6 text-center"
        style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.22em' }}
      >
        COLOPHON · ISSUE {String(issue.number).padStart(3, '0')}
      </p>

      <p
        className="ql-serif mb-8 text-center"
        style={{ fontSize: '20px', fontStyle: 'italic', color: 'var(--muted)' }}
      >
        {issue.theme}
      </p>

      {/* Source credits */}
      <div>
        {issue.sources.map((src) => (
          <div
            key={src.number}
            className="flex items-baseline gap-4 py-3"
            style={{ borderTop: '1px solid var(--rule)' }}
          >
            <span
              className="ql-mono flex-shrink-0"
              style={{ fontSize: '9px', color: 'var(--dim)', letterSpacing: '0.14em', width: '24px' }}
            >
              {src.number}
            </span>
            <div className="flex-1 min-w-0">
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ql-serif hover:underline focus:outline-none focus-visible:underline"
                style={{
                  fontSize: '15px',
                  fontStyle: 'italic',
                  color: 'var(--fg)',
                  textDecoration: 'none',
                  display: 'block',
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  padding: '4px 0',
                  margin: '-4px 0',
                }}
              >
                {src.source}
              </a>
              <span
                className="ql-mono"
                style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.12em' }}
              >
                {src.domain}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Tomorrow's teaser */}
      {issue.tomorrowTheme && (
        <div className="mt-10 text-center">
          <p
            className="ql-mono mb-2"
            style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.18em' }}
          >
            TOMORROW
          </p>
          <p
            className="ql-serif"
            style={{ fontSize: '17px', fontStyle: 'italic', color: 'var(--muted)' }}
          >
            {issue.tomorrowTheme}
          </p>
          {issue.tomorrowArrivesAt && (
            <p
              className="ql-mono mt-1"
              style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.14em' }}
            >
              {issue.tomorrowArrivesAt}
            </p>
          )}
        </div>
      )}

      {/* Fine print */}
      <p
        className="ql-serif mt-12 text-center"
        style={{ fontSize: '12px', fontStyle: 'italic', color: 'var(--dim)' }}
      >
        Tangent · {issue.dateShort}
      </p>
    </div>
  );
}
