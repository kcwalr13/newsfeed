// Rule-filter funnel for the index-mining stream (R7-2c) — the cheap, no-LLM
// gauntlet every raw outbound candidate runs before it can become a digest item.
//
// Pipeline: runIndexMining() (raw outbound URLs) → cheap filters (durable
// dedup + mega-site drop + one-per-domain) → liveness/realness verify (fetch
// each; drop 404 / parked / login-wall / dead) → type classify (website /
// thread / music / video / find from URL + page signals) → a bounded, source-
// diverse set of verified link-out candidates.
//
// SERVER-SIDE ONLY (it fetches arbitrary pages). The interestingness/taste LLM
// judge is R7-3, NOT here — this stage is purely rule-based, so it costs no LLM
// quota. The page text it captures (title/description) only ever reaches an LLM
// later through the curator-note generator, which already fences it with
// wrapUntrusted + UNTRUSTED_CONTENT_NOTICE (R2-M4).

import { parse, type HTMLElement } from 'node-html-parser';
import type { ContentType } from '@/lib/types/article';
import { canonicalizeUrlForDedup, registrableDomain } from '@/lib/utils/url';
import { decodeHtmlEntities } from '@/lib/utils/htmlEntities';
import { isMegaSite, isCommercialInfra, noveltyKey } from './novelty';
import { loadSeenCanonicalUrls, loadSeenNoveltyKeys } from '@/lib/db/discoverySeen';
import { runIndexMining, type IndexCandidate } from './indexMiner';
import { forEachWithConcurrency } from '@/lib/utils/concurrency';
import {
  INDEX_FUNNEL_ITEMS_PER_DAY,
  INDEX_FUNNEL_MAX_VERIFY,
  INDEX_FUNNEL_CONCURRENCY,
  INDEX_FUNNEL_MAX_JUDGE,
  INDEX_FUNNEL_JUDGE_CONCURRENCY,
} from '@/lib/config/feed';
import { appendLog } from '@/lib/pipeline/storage';
import { isLlmConfigured } from '@/lib/llm';
import { judgeInterestingness, judgePasses } from './interestingnessJudge';
import { loadTasteContext, type TasteContext } from './tasteContext';
import { runLlmHunt } from './llmHunt';

/** A verified, type-classified link-out candidate ready to become a digest item. */
export interface FunnelItem {
  /** The final (post-redirect) destination URL — confirmed loadable. */
  url: string;
  /** The real page title (og:title / <title>), or a sensible fallback. */
  title: string;
  /** Page meta/og description, used as the card blurb fallback before the LLM
   *  curator note is generated. */
  description?: string;
  /** Rule-classified item type (website by default; thread/music/video/find by
   *  URL + page signals). `article` is never minted here (R7-2 ships link-out
   *  items only; readable index finds wait on the R7-3 judge). */
  contentType: ContentType;
  /** Provenance: which index surfaced it. Telemetry only — never shown. */
  discoverySource: string;
  /** og:image (absolutized), for the R7-4 per-type card. */
  thumbnailUrl?: string;
  /** og:site_name, a human label for the destination where available. */
  siteName?: string;
  /** Popularity signal the index exposed (HN points, reddit ups). */
  score?: number;
  /** Sample of the page's visible text (captured at liveness verify) — fed to the
   *  R7-3 interestingness judge. Funnel-internal; never shipped to the client. */
  bodySample?: string;
  /** R7-3 judge interestingness (1–5) once judged — used to rank the kept gems
   *  best-first within the funnel. Funnel-internal; never shipped. */
  judgeScore?: number;
}

const FETCH_TIMEOUT_MS = 8000;
const BODY_SAMPLE_CHARS = 4000;
const MAX_HTML_BYTES = 2_000_000;
const BOT_UA = 'Mozilla/5.0 (compatible; TangentDiscoveryBot/1.0; +https://tangent.app)';

// --- liveness / realness rules (no LLM) ---

/** Parked / for-sale domain signals (title or short body). */
const PARKED_RE =
  /\b(buy this domain|domain (is )?(for sale|parked)|this domain (is|may be) for sale|parked (free|domain)|is for sale\b|available for purchase|courtesy of (godaddy|namecheap|sedo)|hugedomains|sedoparking)\b/i;
/** Known domain-parking / for-sale hosts. */
const PARKING_HOSTS = new Set([
  'hugedomains.com', 'sedo.com', 'dan.com', 'afternic.com', 'bodis.com',
  'parkingcrew.net', 'sedoparking.com', 'undeveloped.com',
]);
/** Soft-404 / gone signals in the title. */
const NOT_FOUND_RE = /\b(404|page not found|not found|no longer (exists|available)|account suspended|site (suspended|disabled))\b/i;
/** Bot-wall / login-wall / JS-challenge signals (drop — not a usable gem). */
const WALL_RE =
  /\b(just a moment\b|attention required|verify you are (a )?human|are you a robot|enable (javascript|js)( and cookies)?|please enable javascript|you (must|need to) (be )?(sign|log)(ed)? ?in|sign in to (continue|read|view)|log in to (continue|read|view)|access denied|403 forbidden)\b/i;

export type LivenessFailure = 'http_error' | 'fetch_timeout' | 'empty' | 'parked' | 'wall';

export interface LivePage {
  alive: true;
  finalUrl: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  siteName?: string;
  /** Sample of the page's visible text (already extracted for the liveness
   *  heuristics) — reused by the R7-3 judge instead of a second fetch. */
  bodySample?: string;
}
export interface DeadPage {
  alive: false;
  reason: LivenessFailure;
}
export type LivenessResult = LivePage | DeadPage;

function attr(root: HTMLElement, selector: string, name = 'content'): string | undefined {
  try {
    const el = root.querySelector(selector);
    const v = el?.getAttribute(name);
    return v ? decodeHtmlEntities(v).trim() : undefined;
  } catch {
    return undefined;
  }
}

function absolutize(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetches a candidate URL and decides whether it's a real, working page —
 * dropping 404 / parked-domain / login-wall / bot-challenge / empty placeholders.
 * On success returns the page's real title / description / og:image / site name.
 * Never throws — any error maps to a typed failure the funnel drops on.
 */
export async function verifyLiveness(url: string): Promise<LivenessResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
      headers: { 'User-Agent': BOT_UA, Accept: 'text/html,application/xhtml+xml' },
    });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') return { alive: false, reason: 'fetch_timeout' };
    return { alive: false, reason: 'http_error' };
  }
  if (!res.ok) return { alive: false, reason: 'http_error' };

  const finalUrl = res.url || url;
  if (PARKING_HOSTS.has(registrableDomain(finalUrl))) return { alive: false, reason: 'parked' };

  const ctype = res.headers.get('content-type') ?? '';
  // A non-HTML 200 (image, PDF, audio) IS a real resource — keep it as a bare
  // live page (title falls back to the domain; no parse possible).
  if (ctype && !/text\/html|application\/xhtml/i.test(ctype)) {
    return { alive: true, finalUrl, title: '' };
  }

  let html: string;
  try {
    const buf = await res.arrayBuffer();
    html = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, MAX_HTML_BYTES));
  } catch {
    return { alive: false, reason: 'http_error' };
  }

  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return { alive: false, reason: 'empty' };
  }

  const title =
    attr(root, 'meta[property="og:title"]') ??
    (root.querySelector('title')?.text ? decodeHtmlEntities(root.querySelector('title')!.text).trim() : undefined) ??
    '';
  const description =
    attr(root, 'meta[property="og:description"]') ?? attr(root, 'meta[name="description"]');
  const siteName = attr(root, 'meta[property="og:site_name"]');
  const thumbnailUrl = absolutize(attr(root, 'meta[property="og:image"]'), finalUrl);

  // Strip scripts/styles, then sample the visible text for liveness heuristics.
  for (const sel of ['script', 'style', 'noscript']) {
    try {
      root.querySelectorAll(sel).forEach((el) => el.remove());
    } catch {
      /* ignore unsupported selector */
    }
  }
  const bodyText = (root.querySelector('body')?.textContent ?? root.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BODY_SAMPLE_CHARS);

  if (!title && bodyText.length < 50) return { alive: false, reason: 'empty' };
  if (NOT_FOUND_RE.test(title)) return { alive: false, reason: 'http_error' };
  if (WALL_RE.test(title) || (bodyText.length < 600 && WALL_RE.test(bodyText))) {
    return { alive: false, reason: 'wall' };
  }
  if (PARKED_RE.test(title) || (bodyText.length < 600 && PARKED_RE.test(bodyText))) {
    return { alive: false, reason: 'parked' };
  }

  return { alive: true, finalUrl, title, description, thumbnailUrl, siteName, bodySample: bodyText };
}

// --- rule-based type classification (R7-2: website + thread; coarse music/video) ---

const THREAD_HOST_RE =
  /(^|\.)(news\.ycombinator\.com|lobste\.rs|tildes\.net|bsky\.app|mastodon\.|lemmy\.|kbin\.|forum\.|discourse\.)/i;
const VIDEO_HOST_RE = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/i;
const MUSIC_HOST_RE = /(^|\.)(bandcamp\.com|soundcloud\.com)$/i;

/** Bare hostname (lowercased, www-stripped) of a URL, or '' if unparseable. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Classifies a verified candidate's content type from URL host + page signals.
 * R7-2 ships link-out items, so this returns website (default) / thread / music
 * / video / find — never `article`. A discussion host → thread; a `*.social`
 * Mastodon host or a discourse `/t/<slug>/<id>` path → thread; bandcamp →
 * music; youtube/vimeo → video (mostly mega-filtered upstream). Everything else
 * is a `website` (a place to get lost in).
 */
export function classifyContentType(url: string): ContentType {
  const host = hostOf(url);
  if (!host) return 'website';
  if (THREAD_HOST_RE.test(host) || /\.social$/i.test(host)) return 'thread';
  try {
    if (/^\/t\/[^/]+\/\d+/.test(new URL(url).pathname)) return 'thread'; // discourse thread
  } catch {
    /* ignore */
  }
  if (MUSIC_HOST_RE.test(host)) return 'music';
  if (VIDEO_HOST_RE.test(host)) return 'video';
  return 'website';
}

// --- the funnel ---

export interface RunIndexFunnelOptions {
  /** Canonical URLs already in the batch (fixed/Brave) — dropped as duplicates. */
  excludeCanonical?: Set<string>;
  /** Max verified link-out items to return (digest budget). */
  limit?: number;
  /** Max candidates to fetch-verify in a run (wall-clock budget). */
  maxVerify?: number;
  /**
   * Durable novelty sets to dedup against. Default: loaded from
   * `discovery_seen_urls` (loadSeenCanonicalUrls / loadSeenNoveltyKeys). Injecting
   * them lets a caller reuse already-loaded sets — and lets the dedup path be
   * exercised in a targeted check without writing test rows to Neon.
   */
  seenCanonical?: Set<string>;
  seenKeys?: Set<string>;
  /** Kyle's taste context for the R7-3 interestingness judge (and stream 2).
   *  Default: loaded once via `loadTasteContext()`. Injectable for tests. */
  taste?: TasteContext;
  /** Absolute epoch-ms after which the judge stage stops issuing new LLM calls
   *  and returns what it has (graceful partial degradation under the funnel's
   *  wall-clock budget). Default: no internal deadline (the pipeline's outer
   *  Promise.race is the only bound). */
  deadlineMs?: number;
  /** Extra candidates to fold into the index-mined pool before the funnel runs —
   *  the LLM agentic stream's proposals (R7-3 stream 2) join here so they get the
   *  same cheap filters → liveness verify → judge gauntlet. Default: none. */
  extraCandidates?: IndexCandidate[];
}

/** Round-robins items by `discoverySource` so the kept set spans many indexes
 *  rather than being dominated by the one that yielded the most. */
function interleaveBySource<T extends { discoverySource: string }>(items: T[]): T[] {
  const bySource = new Map<string, T[]>();
  for (const it of items) {
    const q = bySource.get(it.discoverySource);
    if (q) q.push(it);
    else bySource.set(it.discoverySource, [it]);
  }
  const queues = [...bySource.values()];
  const out: T[] = [];
  for (let advanced = true; advanced; ) {
    advanced = false;
    for (const q of queues) {
      const it = q.shift();
      if (it) {
        out.push(it);
        advanced = true;
      }
    }
  }
  return out;
}

/**
 * Runs the full index-mining → rule-filter funnel and returns a bounded, source-
 * diverse set of verified link-out candidates.
 *
 * Cheap filters first (zero network/LLM): drop candidates already in the batch,
 * already surfaced before (durable novelty memory — canonical URL OR domain
 * key), mainstream mega-sites (never gems), and collapse to one item per domain
 * per run. Then fetch-verify the survivors (bounded concurrency) for liveness/
 * realness, type-classify, and keep the first `limit` after a final source
 * interleave. Per-candidate failures are isolated — a dead URL never aborts the
 * run; an empty result just yields a shorter digest (graceful degradation).
 */
export async function runIndexFunnel(opts: RunIndexFunnelOptions = {}): Promise<FunnelItem[]> {
  const limit = opts.limit ?? INDEX_FUNNEL_ITEMS_PER_DAY;
  const maxVerify = opts.maxVerify ?? INDEX_FUNNEL_MAX_VERIFY;
  const exclude = opts.excludeCanonical ?? new Set<string>();

  // Kyle's taste — loaded once and shared by the LLM agentic stream (theme anchor)
  // and the interestingness judge (fit). Graceful empty on cold-start / DB error.
  const taste: TasteContext = opts.taste ?? (await loadTasteContext());

  // Candidate pool spans the streams: index-mined outbound links (stream 1) + the
  // LLM agentic stream's proposals (stream 2 — taste-anchored, rotating theme) +
  // any extra candidates a caller folds in. Streams 1 & 2 run concurrently; both
  // are best-effort ([] on failure). Stream 2's proposals are NOT trusted — they
  // join the SAME cheap-filter → liveness-verify → judge gauntlet below (the model
  // hallucinates URLs and skews popular, so verification + the judge are
  // load-bearing). Cross-source dedup by canonical URL so a shared URL is run once.
  const [mined, hunted] = await Promise.all([
    runIndexMining(),
    runLlmHunt(taste),
  ]);
  const extra = opts.extraCandidates ?? [];
  const rawSeen = new Set<string>();
  const raw: IndexCandidate[] = [];
  for (const c of [...mined, ...hunted, ...extra]) {
    if (!c.url) continue;
    const k = canonicalizeUrlForDedup(c.url);
    if (rawSeen.has(k)) continue;
    rawSeen.add(k);
    raw.push(c);
  }
  if (raw.length === 0) {
    appendLog('[index-funnel] no raw candidates (index mining + llm hunt both empty)');
    return [];
  }
  appendLog(`[index-funnel] candidates: mined=${mined.length} hunted=${hunted.length} extra=${extra.length} → raw=${raw.length}`);

  // Durable novelty memory: a find never repeats (canonical URL OR domain key).
  // Empty (no-op) on any DB error or before migration 020 — deploy-safe.
  const [seenCanonical, seenKeys] = await Promise.all([
    opts.seenCanonical ?? loadSeenCanonicalUrls(),
    opts.seenKeys ?? loadSeenNoveltyKeys(),
  ]);

  // Cheap rule-filters (no network): dedup vs batch + durable memory, drop
  // mega-sites, and collapse to one candidate per domain per run for diversity.
  const seenDomainThisRun = new Set<string>();
  let dupCount = 0;
  let megaCount = 0;
  let commercialCount = 0;
  const survivors: IndexCandidate[] = [];
  for (const c of raw) {
    if (!c.url) continue;
    const canonical = canonicalizeUrlForDedup(c.url);
    if (exclude.has(canonical) || seenCanonical.has(canonical)) {
      dupCount++;
      continue;
    }
    const key = noveltyKey(c.url);
    if (seenKeys.has(key)) {
      dupCount++;
      continue;
    }
    if (isMegaSite(c.url)) {
      megaCount++;
      continue;
    }
    // R7-3: cheap commercial/infra backstop — ad networks / CDNs / SaaS-marketing
    // are never gems; drop them before the LLM judge (saves a judge call and
    // guarantees the worst offenders never ship even if the judge is unavailable).
    if (isCommercialInfra(c.url)) {
      commercialCount++;
      continue;
    }
    if (seenDomainThisRun.has(key)) continue; // one per domain per run
    seenDomainThisRun.add(key);
    survivors.push(c);
  }

  // Verify a source-diverse, bounded slice (wall-clock budget). Interleave so a
  // single prolific index can't monopolize the verification budget.
  const toVerify = interleaveBySource(survivors).slice(0, maxVerify);

  const verified: FunnelItem[] = [];
  const failTally: Partial<Record<LivenessFailure, number>> = {};
  let redirectDupCount = 0;
  let redirectMegaCount = 0;
  // Final-URL re-filter: a redirect can land two raw candidates on one
  // destination, redirect a still-novel raw URL onto an already-seen domain, OR
  // redirect a novel non-mega raw URL (a t.co/bit.ly wrapper, an are.na bounce)
  // onto a mainstream mega-site — none of which the pre-fetch cheap filter
  // (keyed on the RAW url) can catch. So re-apply the batch + durable +
  // one-per-domain + mega-site checks to the POST-redirect final URL. The
  // check+add runs synchronously after each await, so it's race-free under the
  // bounded concurrency.
  const finalDomainSeen = new Set<string>();
  await forEachWithConcurrency(toVerify, INDEX_FUNNEL_CONCURRENCY, async (c) => {
    const result = await verifyLiveness(c.url);
    if (!result.alive) {
      failTally[result.reason] = (failTally[result.reason] ?? 0) + 1;
      return;
    }
    if (isMegaSite(result.finalUrl) || isCommercialInfra(result.finalUrl)) {
      redirectMegaCount++;
      return;
    }
    const finalCanonical = canonicalizeUrlForDedup(result.finalUrl);
    const finalKey = noveltyKey(result.finalUrl);
    if (
      exclude.has(finalCanonical) ||
      seenCanonical.has(finalCanonical) ||
      seenKeys.has(finalKey) ||
      finalDomainSeen.has(finalKey)
    ) {
      redirectDupCount++;
      return;
    }
    finalDomainSeen.add(finalKey);
    const title =
      result.title?.trim() || c.title?.trim() || result.siteName?.trim() || registrableDomain(result.finalUrl);
    verified.push({
      url: result.finalUrl,
      title: title.slice(0, 200),
      description: result.description?.slice(0, 400),
      contentType: classifyContentType(result.finalUrl),
      discoverySource: c.discoverySource,
      thumbnailUrl: result.thumbnailUrl,
      siteName: result.siteName,
      score: c.score,
      bodySample: result.bodySample,
    });
  });

  // R7-3 INTERESTINGNESS / SAFETY JUDGE — the universal LLM gate. A type-aware,
  // taste-fed call per verified survivor decides whether it's a genuinely
  // interesting one-off (keep) or generic/commercial/spam/unsafe (drop): this is
  // where alive-but-junky pages the rule filters let through (ad/CDN/product
  // pages, SEO slop) get killed. Bounded to the top INDEX_FUNNEL_MAX_JUDGE
  // survivors (interleaved by source so it spends the budget diversely), gated by
  // the shared Gemini limiter, and deadline-aware (returns partial under the
  // funnel's wall-clock budget). Fail-CLOSED per item: a judge error or a
  // non-passing verdict drops the candidate.
  //
  // GRACEFUL DEGRADATION: when no LLM is configured the judge can't run, so the
  // funnel ships the rule-filtered verified pool (R7-2 behavior) — the cheap
  // commercial/infra + mega + liveness filters still applied, so the worst junk is
  // already gone. A digest of rule-filtered gems beats no digest. (`taste` is
  // loaded once at the top of the run — shared with the LLM agentic stream.)
  const toJudge = interleaveBySource(verified).slice(0, INDEX_FUNNEL_MAX_JUDGE);

  let kept: FunnelItem[];
  let judgeStats = '';
  if (!isLlmConfigured()) {
    kept = toJudge;
    judgeStats = `judge=skipped(no-llm) kept=${kept.length}`;
    appendLog('[index-funnel] LLM not configured — shipping rule-filtered gems unjudged (graceful)');
  } else {
    const passed: FunnelItem[] = [];
    let judged = 0;
    let droppedUnsafe = 0;
    let droppedCommercial = 0;
    let droppedLowScore = 0;
    let judgeFailed = 0;
    let deadlineSkipped = 0;
    await forEachWithConcurrency(toJudge, INDEX_FUNNEL_JUDGE_CONCURRENCY, async (item) => {
      if (opts.deadlineMs != null && Date.now() >= opts.deadlineMs) {
        deadlineSkipped++;
        return; // out of budget — drop the rest (fail-closed)
      }
      const r = await judgeInterestingness(
        {
          url: item.url,
          contentType: item.contentType,
          title: item.title,
          description: item.description,
          bodySample: item.bodySample,
        },
        taste
      );
      judged++;
      if (!r.success) {
        judgeFailed++;
        appendLog(`[index-funnel] JUDGE_FAIL ${registrableDomain(item.url)} -- ${r.reason}`);
        return;
      }
      const v = r.verdict;
      if (judgePasses(v)) {
        passed.push({ ...item, judgeScore: v.interestingness });
      } else {
        if (!v.safe) droppedUnsafe++;
        else if (v.commercialOrSpam) droppedCommercial++;
        else droppedLowScore++;
        appendLog(
          `[index-funnel] JUDGE_DROP ${registrableDomain(item.url)} ` +
            `(score=${v.interestingness} safe=${v.safe} commercial=${v.commercialOrSpam}) -- ${v.reason}`
        );
      }
    });
    kept = passed;
    judgeStats =
      `judged=${judged}/${toJudge.length} kept=${passed.length} ` +
      `dropped(unsafe=${droppedUnsafe} commercial=${droppedCommercial} lowScore=${droppedLowScore} ` +
      `judgeFail=${judgeFailed} deadline=${deadlineSkipped})`;
  }

  // Rank kept gems best-first by judge score (popularity score as tiebreak), then
  // source-interleave and cap to the digest budget so the kept set stays diverse.
  kept.sort((a, b) => (b.judgeScore ?? 0) - (a.judgeScore ?? 0) || (b.score ?? 0) - (a.score ?? 0));
  const selected = interleaveBySource(kept).slice(0, limit);

  const failSummary =
    Object.entries(failTally).map(([k, v]) => `${k}=${v}`).join(' ') || 'none';
  appendLog(
    `[index-funnel] YIELD raw=${raw.length} ` +
      `dropped(dup=${dupCount} mega=${megaCount} commercial=${commercialCount} redirectDup=${redirectDupCount} redirectMega=${redirectMegaCount}) ` +
      `survivors=${survivors.length} verified=${toVerify.length}→${verified.length} ` +
      `${judgeStats} selected=${selected.length}/${limit} :: liveness-fails ${failSummary}`
  );
  return selected;
}
