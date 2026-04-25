// SERVER-SIDE ONLY — never import in browser bundles.

import { parse } from 'node-html-parser';

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
 * Fetches the given URL and extracts its main body text.
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
 * Extracts body text from raw HTML using node-html-parser.
 * Exported for testing — allows injecting pre-fetched HTML without HTTP.
 */
export function extractBodyTextFromHtml(html: string, _url: string): ExtractionResult {
  let root;
  try {
    root = parse(html);
  } catch {
    return { success: false, reason: 'extraction_failed' };
  }

  // Remove noise elements
  const noiseSelectors = [
    'script', 'style', 'noscript', 'iframe', 'nav', 'header', 'footer',
    'aside', 'form', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '.sidebar', '.nav', '.menu', '.advertisement', '.ad', '.social-share',
    '.comments', '#comments',
  ];
  for (const sel of noiseSelectors) {
    try {
      root.querySelectorAll(sel).forEach((el: import('node-html-parser').HTMLElement) => el.remove());
    } catch {
      // ignore unsupported selectors
    }
  }

  // Try to find main content container, falling back to body then root
  const contentSelectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.entry-content',
    '.article-body',
    '.post-body',
    '.story-body',
    '.content-body',
    '#article-body',
    '#main-content',
    '.prose',
  ];

  let contentEl = null;
  for (const sel of contentSelectors) {
    try {
      const found = root.querySelector(sel);
      if (found) { contentEl = found; break; }
    } catch {
      // ignore unsupported selectors
    }
  }

  const source = contentEl ?? root.querySelector('body') ?? root;

  const rawText = source.textContent ?? '';
  const plainText = rawText
    .replace(/\s+/g, ' ')
    .trim();

  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  if (wordCount < 300) {
    return { success: false, reason: 'below_minimum_length' };
  }

  return { success: true, bodyText: plainText };
}
