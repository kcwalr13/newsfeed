// Blogroll parser: extracts site URLs from HTML blogrolls and OPML files,
// and discovers RSS/Atom feed URLs for candidate sites.

import { XMLParser } from 'fast-xml-parser';

export interface BlogrollCandidate {
  url: string;       // normalized homepage URL of the discovered site
  feedUrl: string;   // discovered RSS/Atom feed URL
}

/**
 * Parses an HTML page and returns an array of candidate site URLs discovered
 * via blogroll patterns. Does not deduplicate against the DB.
 */
export function parseBlogrollLinks(html: string, sourceUrl: string): string[] {
  let sourceHost: string;
  try {
    sourceHost = new URL(sourceUrl).hostname;
  } catch {
    sourceHost = '';
  }

  const collected: string[] = [];

  // Rule 1: <a rel="blogroll" href="..."> tags
  const relBlogrollRe = /<a[^>]+rel=["'][^"']*blogroll[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = relBlogrollRe.exec(html)) !== null) {
    const normalized = normalizeToHost(m[1], sourceUrl);
    if (normalized && !isSameHost(normalized, sourceHost)) {
      collected.push(normalized);
    }
  }
  // Also handle href before rel
  const hrefFirstRe = /<a[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*blogroll[^"']*["'][^>]*>/gi;
  while ((m = hrefFirstRe.exec(html)) !== null) {
    const normalized = normalizeToHost(m[1], sourceUrl);
    if (normalized && !isSameHost(normalized, sourceHost)) {
      collected.push(normalized);
    }
  }

  // Rule 2: <a href="...*.opml"> — collect OPML URLs separately for OPML fetching
  // (returned inline as raw opml URLs — caller detects .opml suffix)
  const opmlRe = /<a[^>]+href=["']([^"']*\.opml[^"']*)["'][^>]*>/gi;
  while ((m = opmlRe.exec(html)) !== null) {
    try {
      const resolved = new URL(m[1], sourceUrl).toString();
      collected.push(resolved);
    } catch {
      // skip invalid URLs
    }
  }

  // Rule 3: <a> inside elements with class/id containing "blogroll" (case-insensitive)
  // Find blogroll containers and extract external href values
  const blogrollContainerRe = /<(?:div|ul|ol|nav|aside|section|article)[^>]+(?:class|id)=["'][^"']*blogroll[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|ul|ol|nav|aside|section|article)>/gi;
  while ((m = blogrollContainerRe.exec(html)) !== null) {
    const inner = m[1];
    const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(inner)) !== null) {
      const normalized = normalizeToHost(lm[1], sourceUrl);
      if (normalized && !isSameHost(normalized, sourceHost)) {
        collected.push(normalized);
      }
    }
  }

  // Rule 4: <a> tags inside <nav> or <aside> with external href and short/no-space text
  const navAsideRe = /<(?:nav|aside)[^>]*>([\s\S]*?)<\/(?:nav|aside)>/gi;
  while ((m = navAsideRe.exec(html)) !== null) {
    const inner = m[1];
    const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(inner)) !== null) {
      const href = lm[1];
      const text = lm[2].trim();
      // Short label: no spaces in text node, or text is <= 30 chars
      if (text && !text.includes(' ') || (text.length > 0 && text.length <= 30)) {
        const normalized = normalizeToHost(href, sourceUrl);
        if (normalized && !isSameHost(normalized, sourceHost)) {
          collected.push(normalized);
        }
      }
    }
  }

  // Deduplicate
  return [...new Set(collected)];
}

/**
 * Parses an OPML XML document and returns an array of site URLs.
 */
export function parseOpmlLinks(opmlText: string): string[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(opmlText) as Record<string, unknown>;
  } catch {
    return [];
  }

  const urls: string[] = [];

  function extractOutlines(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        extractOutlines(item);
      }
      return;
    }

    // Check for @_htmlUrl and @_xmlUrl attributes
    const htmlUrl = obj['@_htmlUrl'] as string | undefined;
    const xmlUrl = obj['@_xmlUrl'] as string | undefined;

    if (htmlUrl) {
      const normalized = normalizeToHostFromString(htmlUrl);
      if (normalized) urls.push(normalized);
    }
    if (xmlUrl) {
      // Derive site homepage by stripping common feed path suffixes
      const stripped = xmlUrl
        .replace(/\/(feed|rss|rss\.xml|feed\.xml|atom\.xml)\/?$/i, '')
        .replace(/\/+$/, '');
      const normalized = normalizeToHostFromString(stripped);
      if (normalized) urls.push(normalized);
    }

    // Recurse into nested nodes
    for (const key of Object.keys(obj)) {
      if (key !== '@_htmlUrl' && key !== '@_xmlUrl') {
        extractOutlines(obj[key]);
      }
    }
  }

  extractOutlines(parsed);
  return [...new Set(urls)];
}

/**
 * Given a site homepage URL, attempts to discover the RSS or Atom feed URL.
 * Returns the feed URL string, or null if none found.
 */
export async function discoverFeedUrl(siteUrl: string): Promise<string | null> {
  let html: string;
  try {
    const res = await fetch(siteUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscoveryBot/1.0)' },
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  // Step 2: Look in <head> for <link rel="alternate" type="application/rss+xml"> or atom+xml
  const linkRe = /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/(rss|atom)\+xml["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
  const linkReAlt = /<link[^>]+type=["']application\/(rss|atom)\+xml["'][^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html)) !== null) {
    try {
      return new URL(m[2], siteUrl).toString();
    } catch {
      // skip
    }
  }
  while ((m = linkReAlt.exec(html)) !== null) {
    try {
      return new URL(m[2], siteUrl).toString();
    } catch {
      // skip
    }
  }

  // Step 3: Try common feed paths via HEAD requests
  const feedPaths = ['/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml'];
  for (const path of feedPaths) {
    try {
      const base = new URL(siteUrl);
      const feedUrl = `${base.origin}${path}`;
      const res = await fetch(feedUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscoveryBot/1.0)' },
      });
      if (res.ok) {
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('xml')) {
          return feedUrl;
        }
      }
    } catch {
      // try next
    }
  }

  return null;
}

// --- Private helpers ---

function normalizeToHost(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (!u.hostname) return null;
    return `https://${u.hostname}`;
  } catch {
    return null;
  }
}

function normalizeToHostFromString(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname) return null;
    return `https://${u.hostname}`;
  } catch {
    return null;
  }
}

function isSameHost(normalizedUrl: string, sourceHost: string): boolean {
  if (!sourceHost) return false;
  try {
    const host = new URL(normalizedUrl).hostname;
    return host === sourceHost || host === `www.${sourceHost}` || `www.${host}` === sourceHost;
  } catch {
    return false;
  }
}
