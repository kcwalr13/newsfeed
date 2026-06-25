// Source-novelty support for discovery (P3-A3): the set of domains the user
// already knows (fixed sources) or has seen recently (last K issues), so the
// discovery layer can drop non-novel candidates before the expensive eval.

import fs from 'fs';
import { sql } from '@/lib/db/client';
import { registrableDomain } from '@/lib/utils/url';
import { SOURCES_PATH } from '@/lib/pipeline/config';
import { appendLog } from '@/lib/pipeline/storage';
import type { Source } from '@/lib/types/article';

/**
 * Mega-sites that are never "hidden gems" no matter how novel — mainstream
 * platforms (social, video, reference, mega-retail, code hosts, top-tier news)
 * that pollute discovery if they slip past the novelty filter (R4-03; Wikipedia
 * was seen in prod). Checked by registrable domain, so language/region
 * subdomains (en.wikipedia.org → wikipedia.org) are covered. Focused starter
 * list — extend as needed. NOT a list of "seen" sources; these are dropped
 * outright before the expensive eval.
 */
export const MEGA_SITE_DENYLIST = new Set<string>([
  // Reference / encyclopedic
  'wikipedia.org', 'wikimedia.org', 'wiktionary.org', 'britannica.com', 'wikihow.com', 'fandom.com',
  // Video / streaming / audio
  'youtube.com', 'youtu.be', 'vimeo.com', 'netflix.com', 'twitch.tv', 'soundcloud.com',
  // Social / forums / aggregators
  'reddit.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'linkedin.com', 'pinterest.com', 'tiktok.com', 'quora.com', 'threads.net',
  // Q&A / code hosting
  'stackoverflow.com', 'stackexchange.com', 'github.com', 'gitlab.com',
  // Commerce / catalog / reviews
  'amazon.com', 'goodreads.com', 'imdb.com', 'spotify.com', 'yelp.com',
  // Mega news / wire
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'theguardian.com',
  'cnn.com', 'bbc.com', 'bbc.co.uk', 'forbes.com', 'bloomberg.com',
  'huffpost.com', 'buzzfeed.com', 'apnews.com', 'reuters.com',
]);

/**
 * Commercial / infrastructure domains that are NEVER one-off gems no matter how
 * novel — ad networks, CDNs/edge/hosting/cloud CORPORATE sites, analytics, and
 * payment platforms (R7-3). A cheap rule-based backstop layered alongside
 * `MEGA_SITE_DENYLIST`: it drops obvious commercial-infra junk BEFORE the LLM
 * interestingness judge (saving a judge call AND guaranteeing the worst offenders
 * never ship even if the judge is unavailable). The LLM judge remains the primary
 * gate for the long tail (arbitrary product/marketing pages, SEO slop — e.g.
 * krea.ai). Two of R7-2's must-reject live targets live here: `carbonads.net`
 * (ad network) and `bunny.net` (CDN corporate site). Keyed by registrable domain.
 *
 * IMPORTANT: list only the CORPORATE/marketing domains (e.g. `netlify.com`,
 * `vercel.com`), never the user-content app subdomains where gems actually live
 * (`*.netlify.app`, `*.vercel.app`, `*.b-cdn.net`) — those resolve to a different
 * registrable domain (already in SHARED_HOSTS) and must stay discoverable.
 */
export const COMMERCIAL_INFRA_DENYLIST = new Set<string>([
  // Ad networks / ad tech / sponsorship marketplaces
  'carbonads.net', 'buysellads.com', 'doubleclick.net', 'googlesyndication.com',
  'adsense.com', 'taboola.com', 'outbrain.com', 'media.net', 'adroll.com',
  'criteo.com', 'ezoic.com', 'mediavine.com', 'adthrive.com',
  // CDNs / edge / asset hosts (corporate sites; NOT their app subdomains)
  'bunny.net', 'bunnycdn.com', 'cloudflare.com', 'fastly.com', 'akamai.com',
  'jsdelivr.net', 'cdnjs.com', 'unpkg.com', 'cloudinary.com', 'imgix.com',
  // Cloud / hosting / dev-platform CORPORATE marketing sites. NB: list the
  // corporate apex only — Railway's user apps live at *.up.railway.app /
  // *.railway.app, whose registrable domain IS `railway.app`, so we deny the
  // marketing apex `railway.com` (and keep railway.app in SHARED_HOSTS, below,
  // for per-author novelty) rather than `railway.app`, which would kill hosted
  // gems. (vercel.com→vercel.app, netlify.com→netlify.app, render.com→onrender.com,
  // heroku.com→herokuapp.com, fly.io→fly.dev all resolve to a DIFFERENT
  // registrable domain, so denying the corporate apex there is already safe.)
  'vercel.com', 'netlify.com', 'heroku.com', 'digitalocean.com', 'render.com',
  'railway.com', 'fly.io', 'linode.com', 'vultr.com',
  // Analytics / monitoring / payments / auth SaaS
  'segment.com', 'mixpanel.com', 'amplitude.com', 'datadoghq.com', 'sentry.io',
  'stripe.com', 'paypal.com', 'squareup.com', 'twilio.com', 'auth0.com',
]);

/** True when a candidate's domain is a commercial/infrastructure site (R7-3) —
 *  never a gem; dropped by the funnel's cheap filter before the LLM judge. */
export function isCommercialInfra(url: string): boolean {
  return COMMERCIAL_INFRA_DENYLIST.has(registrableDomain(url));
}

/**
 * Unambiguously adult / NSFW domains that must never reach a quiet personal
 * digest (R7-3-FIX), keyed by registrable domain. A cheap, deterministic SAFETY
 * FLOOR layered alongside the LLM judge's `is_safe` check: it is applied as a
 * rule-filter BEFORE the judge so the worst offenders cost zero LLM — and,
 * crucially, so the judge's fail-OPEN path (R7-3-FIX: ship rule-filtered gems
 * unjudged when the judge can't RUN under the Gemini rate limit / deadline) still
 * has a safety floor. The LLM judge remains the primary gate for the arbitrary
 * long tail; this list is deliberately CONSERVATIVE (a false positive drops a
 * real gem) — only well-known, unambiguously adult sites belong here.
 */
export const NSFW_DOMAIN_DENYLIST = new Set<string>([
  'pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com',
  'youporn.com', 'tube8.com', 'spankbang.com', 'eporner.com', 'porntrex.com',
  'onlyfans.com', 'fansly.com', 'chaturbate.com', 'cam4.com', 'myfreecams.com',
  'livejasmin.com', 'stripchat.com', 'bongacams.com', 'brazzers.com',
  'nhentai.net', 'rule34.xxx', 'e621.net', 'motherless.com', 'literotica.com',
  'fetlife.com', 'adultfriendfinder.com',
]);

/** True when a candidate's domain is a known adult/NSFW site (R7-3-FIX) — a cheap
 *  deterministic safety floor dropped by the funnel BEFORE the LLM judge, so the
 *  judge's fail-open path keeps a safety floor when it can't run. */
export function isUnsafeDomain(url: string): boolean {
  return NSFW_DOMAIN_DENYLIST.has(registrableDomain(url));
}

/**
 * Shared blogging / newsletter hosts where every author lives on the SAME
 * registrable domain (a subdomain or path) — substack.com, medium.com,
 * github.io, wordpress.com, etc. For these, novelty must key on the full host
 * (alice.substack.com), not the registrable domain, otherwise one author being
 * seen suppresses *every other* author on the platform for the whole lookback
 * window (R4-03). These are NOT denylisted — they are exactly where Small-Web
 * gems live. (Path-based platforms like medium.com/@author still collapse to the
 * one host; subdomain-based ones are correctly distinguished.)
 */
export const SHARED_HOSTS = new Set<string>([
  'substack.com', 'medium.com', 'wordpress.com', 'blogspot.com',
  'github.io', 'gitlab.io', 'tumblr.com', 'ghost.io', 'bearblog.dev',
  'svbtle.com', 'micro.blog', 'posthaven.com', 'hashnode.dev',
  'notion.site', 'netlify.app', 'vercel.app', 'pages.dev', 'neocities.org',
  'dreamwidth.org', 'wixsite.com', 'weebly.com', 'webflow.io',
  // App-hosting domains whose corporate apex differs (so they're NOT denylisted)
  // and where each user app is its own subdomain — key novelty on the full host.
  'railway.app', 'onrender.com', 'herokuapp.com', 'fly.dev',
]);

/** Full lowercased hostname (www-stripped) of a URL, or '' if unparseable. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** True when a candidate's source is a mainstream mega-site (never a gem). */
export function isMegaSite(url: string): boolean {
  return MEGA_SITE_DENYLIST.has(registrableDomain(url));
}

/**
 * The key a URL is recognised by for novelty. For shared blogging hosts this is
 * the full host (so authors are distinguished); for everything else it is the
 * registrable domain. Used to build the seen-set AND to test candidates, so both
 * sides agree (R4-03).
 */
export function noveltyKey(url: string): string {
  const reg = registrableDomain(url);
  if (SHARED_HOSTS.has(reg)) return hostOf(url) || reg;
  return reg;
}

/** Novelty keys of every fixed source (active or not) in data/sources.json. */
function fixedSourceDomains(): Set<string> {
  const set = new Set<string>();
  try {
    const all = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf-8')) as Source[];
    for (const s of all) {
      if (s.url) set.add(noveltyKey(s.url));
      // Feed URLs often sit on a sibling host (api.quantamagazine.org) — fold it
      // in so a Brave hit on the feed host still counts as a known source.
      if (s.feedUrl) set.add(noveltyKey(s.feedUrl));
    }
  } catch {
    // No sources file → fixed set is empty (recent-issue domains still apply).
  }
  return set;
}

/**
 * Builds the set of registrable domains that are NOT novel for the user:
 * every fixed source, plus every source domain that appeared in any of the last
 * `recentIssueCount` issues. Computed on the fly from `article_batches` (no new
 * table — P3-A3) via a lean SQL projection that pulls only the source/article
 * URL strings, never bodyText. Degrades to the fixed-source set on any DB error.
 */
export async function loadSeenSourceDomains(recentIssueCount: number): Promise<Set<string>> {
  const seen = fixedSourceDomains();
  try {
    const rows = await sql`
      SELECT DISTINCT elem->>'sourceUrl' AS source_url, elem->>'articleUrl' AS article_url
      FROM (
        SELECT articles
        FROM article_batches
        ORDER BY batch_date DESC
        LIMIT ${recentIssueCount}
      ) recent
      CROSS JOIN LATERAL jsonb_array_elements(recent.articles) AS elem
    `;
    for (const r of rows as Array<{ source_url: string | null; article_url: string | null }>) {
      const u = r.source_url || r.article_url;
      if (u) seen.add(noveltyKey(u));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[discovery] seen-domain load failed (using fixed sources only): ${msg}`);
  }
  return seen;
}
