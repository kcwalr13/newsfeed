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

/**
 * Meetup detection. Community-calendar announcements ("Berkeley Meetup",
 * "ACX Meetup this Saturday") are low-value for a curated feed, but essays that
 * merely *discuss* meetups are not. The old rule — the bare word "meetup" plus
 * a 60-char length cap — dropped real essays like "Why Meetup Culture Died in
 * Silicon Valley" (R2-05). We now require either an announcement signal
 * (date / day-of-week / clock time / RSVP / "this weekend"…) or a short
 * event-label shape where "meetup" is the leading or trailing noun and the
 * title doesn't open like an essay headline. When unsure we keep the article —
 * a stray announcement is far cheaper than dropping a genuine essay.
 */
const MEETUP_RE = /\bmeetups?\b/i;
const MEETUP_ANNOUNCEMENT_SIGNAL_RE = new RegExp(
  [
    '\\brsvp\\b',
    '\\bregister\\b',
    '\\bsign[\\s-]?up\\b',
    '\\bjoin us\\b',
    '\\bhosted by\\b',
    '\\bvenue\\b',
    '\\b\\d{1,2}\\s*[ap]m\\b',                          // 7pm, 7 pm
    '\\b\\d{1,2}:\\d{2}\\b',                            // 19:30
    '\\b(mon|tues|wednes|thurs|fri|satur|sun)day\\b',  // day of week
    '\\b(this|next)\\s+(week|weekend|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|evening|night)\\b',
    '\\b(tonight|tomorrow)\\b',
  ].join('|'),
  'i'
);
/** Short event-label shape: "Berkeley Meetup" / "Meetup: NYC" (not a sentence). */
const MEETUP_LABEL_MAX = 30;
const MEETUP_LABEL_RE = /(^\s*meetups?\b|\bmeetups?\s*$)/i;
/** Essay/headline openers — titles starting this way are prose, not event labels. */
const MEETUP_ESSAY_OPENER_RE = /^(why|how|what|when|where|who|whose|is|are|was|were|the|a|an|in|on|of|my|our|against)\b/i;

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
  if (MEETUP_RE.test(t) && isMeetupAnnouncement(t)) return 'HOUSEKEEPING';
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

/**
 * Given a title that already contains "meetup", decides whether it's an event
 * announcement (drop) rather than an essay about meetups (keep). True when the
 * title carries a scheduling/RSVP signal, or is a short event label ("Berkeley
 * Meetup") that doesn't open like a headline.
 */
function isMeetupAnnouncement(t: string): boolean {
  if (MEETUP_ANNOUNCEMENT_SIGNAL_RE.test(t)) return true;
  return (
    t.length <= MEETUP_LABEL_MAX &&
    MEETUP_LABEL_RE.test(t) &&
    !MEETUP_ESSAY_OPENER_RE.test(t)
  );
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
