// SERVER-SIDE ONLY — never import in browser bundles.

import { parse } from 'node-html-parser';
import { cleanBodyParagraphs } from '@/lib/utils/bodyClean';

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
    // Share bars / social chrome
    '.share', '.share-buttons', '.share-bar', '.sharing', '.sharedaddy',
    '.social', '.social-links', '.social-media',
    // Related-article / recirculation blocks
    '.related', '.related-posts', '.related-articles', '.jp-relatedposts',
    '.recirculation', '.post-navigation', '.pagination',
    // Newsletter / subscription prompts and misc chrome
    '.newsletter', '.newsletter-signup', '.subscribe', '.subscription',
    '.breadcrumb', '.breadcrumbs', '.tags', '.post-tags',
    '.author-bio', '.author-box', '.byline',
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

  // Extract text paragraph-by-paragraph rather than as one collapsed blob.
  // Block-level elements (p, li, blockquote, h1–h6, div, br) produce paragraph breaks.
  // This preserves the reading structure so the article page can split on '\n'.
  const BLOCK_TAGS = new Set([
    'p', 'li', 'blockquote', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'div', 'section', 'figure', 'figcaption', 'br', 'hr',
    'td', 'th',
  ]);

  function extractText(el: import('node-html-parser').HTMLElement): string {
    const tag = el.tagName?.toLowerCase() ?? '';
    if (!el.childNodes || el.childNodes.length === 0) {
      // Leaf node — return its text content
      return (el.textContent ?? '').replace(/\s+/g, ' ');
    }
    const parts: string[] = [];
    for (const child of el.childNodes) {
      // node-html-parser child nodes may be text nodes or element nodes
      const childEl = child as import('node-html-parser').HTMLElement;
      if (typeof childEl.tagName === 'undefined') {
        // Text node
        parts.push((childEl.textContent ?? '').replace(/\s+/g, ' '));
      } else {
        const childTag = childEl.tagName?.toLowerCase() ?? '';
        if (BLOCK_TAGS.has(childTag)) {
          parts.push('\n' + extractText(childEl) + '\n');
        } else {
          parts.push(extractText(childEl));
        }
      }
    }
    const joined = parts.join('');
    return BLOCK_TAGS.has(tag) ? '\n' + joined + '\n' : joined;
  }

  const rawText = extractText(source);

  // Normalise: collapse runs of spaces within a line, then collapse 3+ newlines to 2,
  // then trim each line and drop blank lines under 2 words (navigation fragments).
  const paragraphs = rawText
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.split(/\s+/).filter(Boolean).length >= 2);

  // Strip page chrome the DOM pass missed: repeated title/byline/dateline at
  // the top, share-bar lines, trailing related-article lists.
  const docTitle =
    root.querySelector('meta[property="og:title"]')?.getAttribute('content') ??
    root.querySelector('title')?.text ??
    undefined;
  const cleaned = cleanBodyParagraphs(paragraphs, docTitle);

  const plainText = cleaned.join('\n');
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  if (wordCount < 300) {
    return { success: false, reason: 'below_minimum_length' };
  }

  return { success: true, bodyText: plainText };
}
