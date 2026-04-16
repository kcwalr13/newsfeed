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

  return { pass: true };
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
