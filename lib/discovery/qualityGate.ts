// Pure function quality gate for evaluating discovery candidate articles.

import type { BraveSearchResult } from './braveSearch';
import {
  DISCOVERY_MAX_AGE_HOURS,
} from '@/lib/config/feed';

export interface QualityGateResult {
  pass: boolean;
  reason?: string;  // set only when pass === false
}

/** Blocklisted domains. Suffix matching: subdomain.blocked.com matches blocked.com. */
const DOMAIN_BLOCKLIST = new Set([
  'buzzfeed.com', 'huffpost.com', 'msn.com', 'yahoo.com', 'aol.com',
  'ask.com', 'answers.com', 'about.com', 'ehow.com', 'wikihow.com',
  'thoughtcatalog.com', 'medium.com', 'substack.com', 'reddit.com',
  'quora.com', 'pinterest.com', 'linkedin.com', 'facebook.com',
  'twitter.com', 'x.com', 'tumblr.com',
]);

/**
 * Evaluates a single Brave Search result against the quality gate criteria.
 * Returns a QualityGateResult with pass/fail and optional reason.
 *
 * @param candidate - The search result to evaluate.
 * @param nowMs - Current timestamp in ms (injectable for testing; defaults to Date.now()).
 */
export function evaluateCandidate(
  candidate: BraveSearchResult,
  nowMs: number = Date.now()
): QualityGateResult {
  // Gate 1: Existing validator rules
  if (!candidate.title || candidate.title.trim() === '') {
    return { pass: false, reason: 'MISSING_TITLE' };
  }
  if (!candidate.url || candidate.url.trim() === '') {
    return { pass: false, reason: 'MISSING_URL' };
  }
  if (!candidate.description || candidate.description.trim() === '') {
    return { pass: false, reason: 'MISSING_DESCRIPTION' };
  }

  // Gate 2: Freshness
  if (candidate.publishedAt === null) {
    return { pass: false, reason: 'UNPARSEABLE_DATE' };
  }
  const publishedMs = new Date(candidate.publishedAt).getTime();
  if (isNaN(publishedMs)) {
    return { pass: false, reason: 'UNPARSEABLE_DATE' };
  }
  const ageHours = (nowMs - publishedMs) / (1000 * 60 * 60);
  if (ageHours > DISCOVERY_MAX_AGE_HOURS) {
    return { pass: false, reason: `TOO_OLD:${Math.round(ageHours)}h` };
  }

  // Gate 3: Source credibility blocklist
  const domain = extractDomain(candidate.sourceUrl || candidate.url);
  if (isBlocklisted(domain)) {
    return { pass: false, reason: `BLOCKLISTED_DOMAIN:${domain}` };
  }

  // Gate 4: Housekeeping/announcement posts and pure-video items
  const lowValue = classifyLowValuePost(candidate.title, candidate.url);
  if (lowValue) {
    return { pass: false, reason: lowValue };
  }

  return { pass: true };
}

/**
 * Housekeeping/announcement post patterns: community threads, meetup
 * announcements, link roundups — valid blog output, but not editorial content
 * for a curated feed.
 */
const HOUSEKEEPING_RES = [
  /^(hidden\s+)?open\s+thread\b/i,           // "Open Thread 437", "Hidden Open Thread"
  /\bopen\s+thread\s*#?\d*$/i,
  /^(weekly|monthly)\s+(open\s+)?thread\b/i,
  /^links?\s+(for|roundup|post|dump)\b/i,    // "Links for June", "Link roundup"
  /^monthly\s+(links|roundup)\b/i,
  /^housekeeping\b/i,
  /^announcements?\b/i,
  /^programming\s+note\b/i,
  /^classifieds?\s+thread\b/i,
  /^subscriber\s+(thread|drive)\b/i,
];

/** Short announcement-style titles mentioning a meetup ("Berkeley Meetup"). */
const MEETUP_RE = /\bmeetups?\b/i;
const MEETUP_TITLE_MAX = 60;

/** Pure-video items: explicit title prefix or a /video(s)/ URL path. */
const VIDEO_TITLE_RE = /^(video|watch)\s*[:\-–]/i;
const VIDEO_PATH_RE = /^\/videos?\//i;

/**
 * Classifies a post as low-value for a curated feed.
 * Returns 'HOUSEKEEPING', 'PURE_VIDEO', or null when the post looks editorial.
 * Used for discovery candidates AND fixed-RSS items (which bypass the LLM eval).
 */
export function classifyLowValuePost(title: string, url?: string): string | null {
  const t = title.trim();
  if (HOUSEKEEPING_RES.some((re) => re.test(t))) return 'HOUSEKEEPING';
  if (t.length <= MEETUP_TITLE_MAX && MEETUP_RE.test(t)) return 'HOUSEKEEPING';
  if (VIDEO_TITLE_RE.test(t)) return 'PURE_VIDEO';
  if (url) {
    try {
      if (VIDEO_PATH_RE.test(new URL(url).pathname)) return 'PURE_VIDEO';
    } catch {
      // unparseable URL — other gates handle it
    }
  }
  return null;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isBlocklisted(domain: string): boolean {
  if (!domain) return false;
  if (DOMAIN_BLOCKLIST.has(domain)) return true;
  // Suffix match: check if domain ends with any blocklisted entry
  for (const blocked of DOMAIN_BLOCKLIST) {
    if (domain.endsWith('.' + blocked)) return true;
  }
  return false;
}
