// Index-mining candidate stream (R7-2b) — the reliable base of the Round-7
// discovery engine.
//
// Tangent is a discovery agent, not a feed reader: the unit is the FIND, not the
// source. This miner crawls a curated set of human link-collections ("gem
// indexes" — Hacker News, link blogs, subreddits, are.na) and harvests the
// OUTBOUND destination links they point at. The index's own posts/pages are
// NEVER items — only what they link TO. (This is deliberately the opposite of
// lib/discovery/smallWeb/crawler.ts, which treats such pages as feed SOURCES.)
//
// R7-2b only HARVESTS + LOGS raw outbound candidates; it is not yet wired into
// the digest. The rule-filter funnel (liveness/realness verify, type classify,
// dedup against the durable novelty memory) and digest integration land in
// R7-2c. So nothing here changes the live pipeline.

import fs from 'fs';
import path from 'path';
import { appendLog } from '@/lib/pipeline/storage';
import { canonicalizeUrlForDedup, registrableDomain } from '@/lib/utils/url';
import { decodeHtmlEntities } from '@/lib/utils/htmlEntities';

/** A single outbound destination harvested from an index (the candidate gem). */
export interface IndexCandidate {
  /** The outbound destination URL the index points at. */
  url: string;
  /** Anchor / post title where the index exposes one (the funnel re-fetches the
   *  real page title at liveness-verify time in R7-2c). */
  title?: string;
  /** Provenance: which index surfaced it. Telemetry only — never shown as a
   *  "source" (the unit is the find). Flows to Article.discoverySource later. */
  discoverySource: string;
  /** Popularity signal where the index exposes one (HN points, reddit ups). */
  score?: number;
}

/** A curated index entry from data/discovery_indexes.json (discriminated by kind). */
export type IndexEntry =
  | { name: string; kind: 'hackernews'; endpoint: 'front_page' | 'show_hn'; enabled?: boolean; maxLinks?: number }
  | { name: string; kind: 'reddit'; subreddit: string; period?: string; enabled?: boolean; maxLinks?: number }
  | { name: string; kind: 'arena'; channel: string; enabled?: boolean; maxLinks?: number }
  | { name: string; kind: 'html'; url: string; enabled?: boolean; maxLinks?: number };

const INDEXES_PATH = path.resolve(process.cwd(), 'data', 'discovery_indexes.json');
const INDEX_FETCH_TIMEOUT_MS = 8000;
const BOT_UA = 'Mozilla/5.0 (compatible; TangentDiscoveryBot/1.0; +https://tangent.app)';

let cache: IndexEntry[] | null = null;

/** Validates one parsed entry into a typed IndexEntry, or null if malformed. */
function asIndexEntry(raw: unknown): IndexEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== 'string' || typeof o.kind !== 'string') return null;
  const enabled = typeof o.enabled === 'boolean' ? o.enabled : true;
  const maxLinks = typeof o.maxLinks === 'number' ? o.maxLinks : undefined;
  switch (o.kind) {
    case 'hackernews':
      if (o.endpoint !== 'front_page' && o.endpoint !== 'show_hn') return null;
      return { name: o.name, kind: 'hackernews', endpoint: o.endpoint, enabled, maxLinks };
    case 'reddit':
      if (typeof o.subreddit !== 'string' || !o.subreddit) return null;
      return { name: o.name, kind: 'reddit', subreddit: o.subreddit, period: typeof o.period === 'string' ? o.period : 'week', enabled, maxLinks };
    case 'arena':
      if (typeof o.channel !== 'string') return null;
      return { name: o.name, kind: 'arena', channel: o.channel, enabled, maxLinks };
    case 'html':
      if (typeof o.url !== 'string' || !o.url) return null;
      return { name: o.name, kind: 'html', url: o.url, enabled, maxLinks };
    default:
      return null;
  }
}

/** Loads (and memoizes) the curated index list; [] if the file is absent/bad. */
export function loadDiscoveryIndexes(): IndexEntry[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEXES_PATH, 'utf-8')) as unknown;
    cache = Array.isArray(parsed)
      ? parsed.map(asIndexEntry).filter((e): e is IndexEntry => e !== null)
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Test/diagnostic hook: clears the memoized list so the next call re-reads disk. */
export function resetIndexesCache(): void {
  cache = null;
}

// --- network helpers (return null/'' on any error; never throw) ---

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(INDEX_FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': BOT_UA, Accept: 'application/json' },
    });
    if (!res.ok) {
      appendLog(`[index-miner] HTTP ${res.status} for ${url}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    appendLog(`[index-miner] fetch failed ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function fetchText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(INDEX_FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': BOT_UA, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) {
      appendLog(`[index-miner] HTTP ${res.status} for ${url}`);
      return '';
    }
    return await res.text();
  } catch (err) {
    appendLog(`[index-miner] fetch failed ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Extracts OUTBOUND destination links from an index page's HTML: absolute
 * http(s) links whose registrable domain differs from the index's own (so the
 * index's nav/footer/self-links are dropped). Deduped by canonical URL, capped
 * at `max`. Mega-site / liveness / type filtering is deliberately left to the
 * R7-2c funnel — this returns the raw outbound set.
 */
export function extractOutboundLinks(html: string, pageUrl: string, max: number): { url: string; title?: string }[] {
  const out: { url: string; title?: string }[] = [];
  const seen = new Set<string>();
  const pageDomain = registrableDomain(pageUrl);

  const anchorRe = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    if (out.length >= max) break;
    const rawHref = decodeHtmlEntities(m[1].trim());
    if (!rawHref || /^(mailto:|javascript:|#|tel:|data:)/i.test(rawHref)) continue;
    let abs: URL;
    try {
      abs = new URL(rawHref, pageUrl);
    } catch {
      continue;
    }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
    if (registrableDomain(abs.href) === pageDomain) continue; // outbound only
    const canonical = canonicalizeUrlForDedup(abs.href);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const title = stripTags(m[2]).slice(0, 200) || undefined;
    out.push({ url: abs.href, title });
  }
  return out;
}

// --- per-kind adapters ---

async function mineHackerNews(endpoint: 'front_page' | 'show_hn', max: number, name: string): Promise<IndexCandidate[]> {
  const hits = Math.min(max, 50);
  const json = await fetchJson(`https://hn.algolia.com/api/v1/search?tags=${endpoint}&hitsPerPage=${hits}`);
  const arr = (json as { hits?: unknown[] } | null)?.hits;
  if (!Array.isArray(arr)) return [];
  const out: IndexCandidate[] = [];
  for (const raw of arr) {
    const h = raw as Record<string, unknown>;
    const url = typeof h.url === 'string' ? h.url : ''; // Ask/text posts have no outbound url
    if (!url) continue;
    out.push({
      url,
      title: typeof h.title === 'string' ? h.title : undefined,
      discoverySource: name,
      score: typeof h.points === 'number' ? h.points : undefined,
    });
  }
  return out;
}

async function mineReddit(subreddit: string, period: string, max: number, name: string): Promise<IndexCandidate[]> {
  const limit = Math.min(max, 50);
  const json = await fetchJson(
    `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/top.json?t=${encodeURIComponent(period)}&limit=${limit}`
  );
  const children = (json as { data?: { children?: unknown[] } } | null)?.data?.children;
  if (!Array.isArray(children)) return [];
  const out: IndexCandidate[] = [];
  for (const child of children) {
    const d = (child as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
    if (!d || d.is_self === true) continue; // self/text posts aren't outbound finds
    const url =
      (typeof d.url_overridden_by_dest === 'string' && d.url_overridden_by_dest) ||
      (typeof d.url === 'string' ? d.url : '');
    if (!url) continue;
    const reg = registrableDomain(url);
    if (reg === 'reddit.com' || reg === 'redd.it') continue; // galleries/crossposts back to reddit
    out.push({
      url,
      title: typeof d.title === 'string' ? d.title : undefined,
      discoverySource: name,
      score: typeof d.ups === 'number' ? d.ups : undefined,
    });
  }
  return out;
}

async function mineArena(channel: string, max: number, name: string): Promise<IndexCandidate[]> {
  if (!channel) return [];
  const per = Math.min(max, 50);
  const json = await fetchJson(
    `https://api.are.na/v2/channels/${encodeURIComponent(channel)}/contents?per=${per}&direction=desc`
  );
  const contents = (json as { contents?: unknown[] } | null)?.contents;
  if (!Array.isArray(contents)) return [];
  const out: IndexCandidate[] = [];
  for (const raw of contents) {
    const block = raw as Record<string, unknown>;
    const source = block.source as Record<string, unknown> | undefined;
    const url = typeof source?.url === 'string' ? source.url : '';
    if (!url) continue;
    const title =
      (typeof block.title === 'string' && block.title) ||
      (typeof block.generated_title === 'string' ? block.generated_title : undefined);
    out.push({ url, title, discoverySource: name });
  }
  return out;
}

async function mineHtml(pageUrl: string, max: number, name: string): Promise<IndexCandidate[]> {
  const html = await fetchText(pageUrl);
  if (!html) return [];
  return extractOutboundLinks(html, pageUrl, max).map((l) => ({
    url: l.url,
    title: l.title,
    discoverySource: name,
  }));
}

/** Default per-kind harvest cap when an entry omits maxLinks. */
function defaultMax(kind: IndexEntry['kind']): number {
  return kind === 'html' ? 40 : 25;
}

/**
 * The index's OWN registrable domain — candidates on it are the index's own
 * pages, not outbound finds (e.g. HN's `news.ycombinator.com/vote?...` links, or
 * a link blog's nav/self-links), so they're dropped. The HTML extractor already
 * filters this; the API adapters (HN/reddit/arena) need it applied centrally.
 */
function selfDomain(entry: IndexEntry): string {
  switch (entry.kind) {
    case 'hackernews':
      return 'ycombinator.com';
    case 'reddit':
      return 'reddit.com';
    case 'arena':
      return 'are.na';
    case 'html':
      return registrableDomain(entry.url);
  }
}

/** Mines a single index for its outbound candidates (dispatch by kind), then
 *  enforces outbound-only (drops any candidate on the index's own domain). */
async function mineIndex(entry: IndexEntry): Promise<IndexCandidate[]> {
  const max = entry.maxLinks ?? defaultMax(entry.kind);
  let candidates: IndexCandidate[];
  switch (entry.kind) {
    case 'hackernews':
      candidates = await mineHackerNews(entry.endpoint, max, entry.name);
      break;
    case 'reddit':
      candidates = await mineReddit(entry.subreddit, entry.period ?? 'week', max, entry.name);
      break;
    case 'arena':
      candidates = await mineArena(entry.channel, max, entry.name);
      break;
    case 'html':
      candidates = await mineHtml(entry.url, max, entry.name);
      break;
  }
  const self = selfDomain(entry);
  return candidates.filter((c) => registrableDomain(c.url) !== self);
}

/**
 * Runs the index-mining stream across all enabled curated indexes and returns
 * the deduped pool of outbound candidate URLs. Per-index isolation (allSettled):
 * a dead/blocked index never thins the pool. Logs a structured YIELD line. Does
 * NOT touch the digest (R7-2b) — wiring into the funnel is R7-2c.
 */
export async function runIndexMining(): Promise<IndexCandidate[]> {
  const indexes = loadDiscoveryIndexes().filter((i) => i.enabled !== false);
  if (indexes.length === 0) {
    appendLog('[index-miner] no enabled indexes configured');
    return [];
  }

  const settled = await Promise.allSettled(indexes.map((idx) => mineIndex(idx)));

  const all: IndexCandidate[] = [];
  const perIndex: string[] = [];
  settled.forEach((s, i) => {
    const name = indexes[i].name;
    if (s.status === 'fulfilled') {
      all.push(...s.value);
      perIndex.push(`${name}=${s.value.length}`);
    } else {
      const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
      appendLog(`[index-miner] FAIL ${name}: ${msg}`);
      perIndex.push(`${name}=ERR`);
    }
  });

  // Cross-index dedup by canonical URL (first index to surface a URL wins).
  const seen = new Set<string>();
  const unique = all.filter((c) => {
    if (!c.url) return false;
    const key = canonicalizeUrlForDedup(c.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  appendLog(
    `[index-miner] YIELD indexes=${indexes.length} harvested=${all.length} unique=${unique.length} :: ${perIndex.join(' ')}`
  );
  return unique;
}
