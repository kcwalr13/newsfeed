/**
 * /dashboard — Tangent instrumentation (P3-D3)
 *
 * Server component reading the metrics computation (P3-D1) directly. Surfaces
 * the five core health signals so the discovery promise can't fail silently:
 * discovery share, sources this week, category spread, exploration acceptance,
 * and taste-model maturity. Editorial styling to match the issue.
 *
 * GATING (R4-11): intentionally NOT access-gated — it's aggregate-only (counts
 * and percentages of the single user's own feed, no per-article content) and
 * the app is single-user with auth off, so this mirrors `/api/metrics`, which is
 * likewise unauthenticated. It scopes to the same device identity the API does
 * via the shared `isValidDeviceId` check (not a divergent local regex). Add a
 * real access gate alongside the API's when multi-user auth is enabled.
 */

import Link from 'next/link';
import { cookies } from 'next/headers';
import { computeMetrics, type TangentMetrics } from '@/lib/db/metrics';
import { isValidDeviceId } from '@/lib/auth/session';
import { EXPLORATION_CEILING } from '@/lib/config/serendipity';

export const dynamic = 'force-dynamic';

const pct = (n: number) => `${Math.round(n * 100)}%`;

function MonoLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="ql-mono"
      style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.22em' }}
    >
      {children}
    </p>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="py-8" style={{ borderTop: '1px solid var(--rule)' }}>
      <MonoLabel>{label}</MonoLabel>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Bar({ value, max, label, count }: { value: number; max: number; label: string; count: string }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span
        className="ql-serif flex-shrink-0"
        style={{ fontSize: '14px', color: 'var(--fg)', width: '110px', fontStyle: 'italic' }}
      >
        {label}
      </span>
      {/* The visible label + count already convey the data to AT; the bar is a
          purely visual proportion, so describe it once and hide the inner fill
          (R4-12, mirroring the SevenDotStrip pattern). */}
      <div
        className="flex-1 h-2 rounded-sm"
        style={{ background: 'var(--accent-soft)' }}
        role="img"
        aria-label={`${label}: ${count}`}
      >
        <div className="h-2 rounded-sm" aria-hidden="true" style={{ width: `${w}%`, background: 'var(--accent)' }} />
      </div>
      <span className="ql-mono flex-shrink-0" style={{ fontSize: '10px', color: 'var(--muted)', width: '40px', textAlign: 'right' }}>
        {count}
      </span>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <MonoLabel>{label}</MonoLabel>
      <p className="ql-serif" style={{ fontSize: '34px', color: 'var(--fg)', lineHeight: 1.1, marginTop: '4px' }}>
        {value}
      </p>
      {sub && (
        <p className="ql-mono" style={{ fontSize: '9px', color: 'var(--dim)', letterSpacing: '0.1em', marginTop: '2px' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const raw = cookieStore.get('dd_device_id')?.value ?? null;
  const deviceId = isValidDeviceId(raw) ? raw : null;

  let metrics: TangentMetrics | null = null;
  let failed = false;
  try {
    metrics = await computeMetrics(null, deviceId);
  } catch (err) {
    console.error('[dashboard] computeMetrics failed:', err);
    failed = true;
  }

  // The discovery-share panel reflects the LATEST stored batch, which is only
  // "today" once the daily cron has run. Label it honestly so a pre-cron view
  // doesn't claim stale numbers are today's (R4-06).
  const utcToday = new Date().toISOString().slice(0, 10);
  const latest = metrics?.latestBatchDate ?? null;
  const latestPanelLabel =
    latest && latest === utcToday
      ? 'TODAY'
      : latest
        ? `LATEST (${new Date(latest + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
        : 'LATEST';

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header style={{ borderBottom: '1px solid var(--rule)' }}>
        <div className="max-w-2xl mx-auto px-5 py-3 flex items-center justify-between">
          <Link
            href="/"
            className="ql-mono hover:underline focus:outline-none focus-visible:underline"
            style={{ fontSize: '10px', color: 'var(--muted)', letterSpacing: '0.1em' }}
          >
            ← Today&rsquo;s issue
          </Link>
          <span className="ql-mono" style={{ fontSize: '9px', color: 'var(--dim)', letterSpacing: '0.22em' }}>
            DASHBOARD
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 pb-16">
        <div className="pt-10 pb-2">
          <h1 className="ql-serif" style={{ fontSize: '30px', color: 'var(--fg)', lineHeight: 1.15 }}>
            The shape of your feed
          </h1>
          <p className="ql-mono mt-2" style={{ fontSize: '9px', color: 'var(--dim)', letterSpacing: '0.14em' }}>
            {metrics?.latestBatchDate ? `THROUGH ${metrics.latestBatchDate}` : 'NO ISSUES YET'}
          </p>
        </div>

        {failed || !metrics ? (
          <p className="ql-serif" style={{ fontSize: '16px', color: 'var(--muted)', fontStyle: 'italic', paddingTop: '24px' }}>
            Metrics are unavailable right now.
          </p>
        ) : (
          <>
            {/* Discovery share */}
            <Section label="DISCOVERY SHARE">
              <div className="flex items-end gap-6">
                <Stat
                  label={latestPanelLabel}
                  value={pct(metrics.discoveryShare.today.discoveryPct)}
                  sub={`${metrics.discoveryShare.today.discovery} of ${metrics.discoveryShare.today.total} pieces discovered`}
                />
                <div className="flex gap-6 pb-2">
                  <div>
                    <MonoLabel>7-DAY</MonoLabel>
                    <p className="ql-serif" style={{ fontSize: '20px', color: 'var(--muted)' }}>
                      {pct(metrics.discoveryShare.last7d.discoveryPct)}
                    </p>
                  </div>
                  <div>
                    <MonoLabel>30-DAY</MonoLabel>
                    <p className="ql-serif" style={{ fontSize: '20px', color: 'var(--muted)' }}>
                      {pct(metrics.discoveryShare.last30d.discoveryPct)}
                    </p>
                  </div>
                </div>
              </div>
              {/* today's discovery vs fixed bar */}
              <div
                className="mt-5 flex h-2 rounded-sm overflow-hidden"
                style={{ background: 'var(--accent-soft)' }}
                role="img"
                aria-label={`${metrics.discoveryShare.today.discovery} of ${metrics.discoveryShare.today.total} pieces from discovery (${pct(metrics.discoveryShare.today.discoveryPct)})`}
              >
                <div
                  className="h-2"
                  aria-hidden="true"
                  style={{ width: pct(metrics.discoveryShare.today.discoveryPct), background: 'var(--accent)' }}
                />
              </div>
            </Section>

            {/* Sources + exploration acceptance */}
            <Section label="REACH & SERENDIPITY">
              <div className="flex gap-12">
                <Stat label="DISTINCT SOURCES / WEEK" value={String(metrics.distinctSourcesThisWeek)} />
                <Stat
                  label="EXPLORATION ACCEPTANCE"
                  value={metrics.explorationAcceptance.shown > 0 ? pct(metrics.explorationAcceptance.rate) : '—'}
                  sub={`${metrics.explorationAcceptance.accepted} liked of ${metrics.explorationAcceptance.shown} shown (30d)`}
                />
              </div>
            </Section>

            {/* Category distribution */}
            <Section label="CATEGORY DISTRIBUTION · 30 DAYS">
              {metrics.categoryDistribution.length === 0 ? (
                <p className="ql-serif" style={{ fontSize: '14px', color: 'var(--dim)', fontStyle: 'italic' }}>
                  No articles yet.
                </p>
              ) : (
                <div>
                  {metrics.categoryDistribution.map((c) => (
                    <Bar
                      key={c.category}
                      label={c.category}
                      value={c.count}
                      max={metrics.categoryDistribution[0].count}
                      count={String(c.count)}
                    />
                  ))}
                </div>
              )}
            </Section>

            {/* Taste maturity */}
            <Section label="TASTE MODEL">
              <dl className="grid grid-cols-2 gap-y-4 gap-x-8">
                <div>
                  <MonoLabel>FEEDBACK EVENTS</MonoLabel>
                  <p className="ql-serif" style={{ fontSize: '22px', color: 'var(--fg)' }}>{metrics.tasteMaturity.feedbackCount}</p>
                </div>
                <div>
                  <MonoLabel>SHORT-TERM EVENTS</MonoLabel>
                  <p className="ql-serif" style={{ fontSize: '22px', color: 'var(--fg)' }}>{metrics.tasteMaturity.shortTermEventCount}</p>
                </div>
                <div>
                  <MonoLabel>STATE</MonoLabel>
                  <p className="ql-serif" style={{ fontSize: '22px', color: metrics.tasteMaturity.isDrifting ? 'var(--accent)' : 'var(--fg)', fontStyle: 'italic' }}>
                    {metrics.tasteMaturity.isDrifting ? 'Drifting' : 'Settling'}
                  </p>
                </div>
                <div>
                  <MonoLabel>RECEPTIVITY</MonoLabel>
                  <p className="ql-serif" style={{ fontSize: '22px', color: 'var(--fg)' }}>
                    {metrics.tasteMaturity.receptivityScore != null ? metrics.tasteMaturity.receptivityScore.toFixed(2) : '—'}
                  </p>
                </div>
                <div>
                  <MonoLabel>EXPLORATION BUDGET</MonoLabel>
                  <p className="ql-serif" style={{ fontSize: '22px', color: 'var(--fg)' }}>{metrics.tasteMaturity.explorationBudget} / {EXPLORATION_CEILING}</p>
                </div>
              </dl>
            </Section>
          </>
        )}

        <p className="ql-serif mt-10 text-center" style={{ fontSize: '12px', fontStyle: 'italic', color: 'var(--dim)' }}>
          Tangent · instrumentation
        </p>
      </main>
    </div>
  );
}
