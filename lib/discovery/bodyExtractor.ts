// SERVER-SIDE ONLY — never import in browser bundles.

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export type ExtractionFailureReason =
  | 'fetch_timeout'
  | 'http_error'
  | 'extraction_failed'
  | 'below_minimum_length';

export interface ExtractionSuccess {
  success: true;
  bodyText: string;
}

export interface ExtractionFailure {
  success: false;
  reason: ExtractionFailureReason;
  detail?: string;
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

/**
 * Fetches the given URL and extracts its main body text using Mozilla Readability.
 * Returns ExtractionSuccess with plain text, or ExtractionFailure with a reason code.
 * No retry logic. Callers should handle failures by skipping the candidate.
 */
export async function extractBodyText(url: string): Promise<ExtractionResult> {
  let html: string;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscoveryBot/1.0)' },
    });
    if (!res.ok) {
      return { success: false, reason: 'http_error', detail: String(res.status) };
    }
    html = await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('TimeoutError') || msg.includes('AbortError') || (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError') {
      return { success: false, reason: 'fetch_timeout' };
    }
    return { success: false, reason: 'http_error', detail: msg };
  }
  return extractBodyTextFromHtml(html, url);
}

/**
 * Extracts body text from raw HTML using Mozilla Readability.
 * Exported for testing — allows injecting pre-fetched HTML without HTTP.
 */
export function extractBodyTextFromHtml(html: string, url: string): ExtractionResult {
  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url });
  } catch {
    return { success: false, reason: 'extraction_failed' };
  }

  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent) {
    return { success: false, reason: 'extraction_failed' };
  }

  // Strip any remaining HTML tags and normalize whitespace
  const plainText = article.textContent
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Word count by whitespace-separated tokens
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  if (wordCount < 300) {
    return { success: false, reason: 'below_minimum_length' };
  }

  return { success: true, bodyText: plainText };
}
