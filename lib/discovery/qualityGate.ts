// Pure function quality gate for evaluating discovery candidate articles.

import type { BraveSearchResult } from './braveSearch';
import {
  DISCOVERY_MAX_AGE_HOURS,
  SPECIFICITY_THRESHOLD,
} from '@/lib/config/feed';

export interface QualityGateResult {
  pass: boolean;
  reason?: string;          // set only when pass === false; for debug logging
  specificityScore: number; // 0.0-1.0; always computed (useful even on failure)
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
 * Returns a QualityGateResult with pass/fail, optional reason, and specificity score.
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
    return { pass: false, reason: 'MISSING_TITLE', specificityScore: 0 };
  }
  if (!candidate.url || candidate.url.trim() === '') {
    return { pass: false, reason: 'MISSING_URL', specificityScore: 0 };
  }
  if (!candidate.description || candidate.description.trim() === '') {
    return { pass: false, reason: 'MISSING_DESCRIPTION', specificityScore: 0 };
  }

  // Gate 2: Freshness
  if (candidate.publishedAt === null) {
    return { pass: false, reason: 'UNPARSEABLE_DATE', specificityScore: 0 };
  }
  const publishedMs = new Date(candidate.publishedAt).getTime();
  if (isNaN(publishedMs)) {
    return { pass: false, reason: 'UNPARSEABLE_DATE', specificityScore: 0 };
  }
  const ageHours = (nowMs - publishedMs) / (1000 * 60 * 60);
  if (ageHours > DISCOVERY_MAX_AGE_HOURS) {
    return { pass: false, reason: `TOO_OLD:${Math.round(ageHours)}h`, specificityScore: 0 };
  }

  // Gate 3: Source credibility blocklist
  const domain = extractDomain(candidate.sourceUrl || candidate.url);
  if (isBlocklisted(domain)) {
    return { pass: false, reason: `BLOCKLISTED_DOMAIN:${domain}`, specificityScore: 0 };
  }

  // Gate 4: Specificity score
  const specificityScore = computeSpecificityScore(candidate.title);
  if (specificityScore < SPECIFICITY_THRESHOLD) {
    return {
      pass: false,
      reason: `LOW_SPECIFICITY:${specificityScore.toFixed(2)}`,
      specificityScore,
    };
  }

  return { pass: true, specificityScore };
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

/**
 * Computes a specificity score (0.0-1.0) for an article title.
 * Starts at 1.0 and applies penalties for generic/clickbait patterns.
 */
export function computeSpecificityScore(title: string): number {
  let score = 1.0;
  const lower = title.toLowerCase();

  // -0.3 penalties
  if (/everything you need to know/i.test(title)) score -= 0.3;
  if (/\b(a |the |your )?(complete|ultimate) guide to\b/i.test(title)) score -= 0.3;

  // -0.2 penalties
  // Listicles with 8+ items: "15 Things About", "10 Ways To"
  if (/^\d{1,2} (things|ways|reasons|tips|facts|steps|ideas|tricks)\b/i.test(title)) {
    const numMatch = title.match(/^(\d+)/);
    if (numMatch && parseInt(numMatch[1], 10) >= 8) score -= 0.2;
  }
  if (/how to .+ in \d+ steps/i.test(title)) {
    const numMatch = title.match(/in (\d+) steps/i);
    if (numMatch && parseInt(numMatch[1], 10) >= 8) score -= 0.2;
  }
  if (/^why .+ is /i.test(title)) score -= 0.2;
  if (/what is .+\? everything/i.test(title)) score -= 0.2;
  if (/^the future of\b/i.test(title)) score -= 0.2;
  if (/is changing everything/i.test(title)) score -= 0.2;

  // -0.15 penalty: clickbait signal words
  const clickbaitWords = [
    'shocking', 'unbelievable', "you won't believe", 'mind-blowing',
    'this is why', "here's why", 'here are', 'you need to see',
  ];
  for (const word of clickbaitWords) {
    if (lower.includes(word)) { score -= 0.15; break; } // max one penalty from this group
  }

  // -0.1 penalties
  if (title === title.toUpperCase() && title.length > 5) score -= 0.1;  // all-caps
  if (title.trimEnd().endsWith('?')) score -= 0.1;                       // ends with question mark

  return Math.max(0.0, score);
}
