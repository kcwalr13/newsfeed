// Brave Search API HTTP adapter for the proactive content discovery subsystem.

export interface BraveSearchResult {
  title: string;
  description: string;
  url: string;
  /** ISO-8601 datetime string. Null if Brave's `age` field cannot be parsed. */
  publishedAt: string | null;
  /** Outlet/publication name derived from Brave's profile.name or the hostname. */
  sourceName: string;
  /** Homepage URL, e.g. https://theatlantic.com */
  sourceUrl: string;
}

/**
 * Issues a web search query to the Brave Search API.
 * Returns an array of raw results. Returns [] on any HTTP or parse error.
 * Never throws -- all errors are logged and swallowed.
 */
export async function searchBrave(
  query: string,
  count: number
): Promise<BraveSearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    console.error('[braveSearch] BRAVE_SEARCH_API_KEY is not set');
    return [];
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(count));
  url.searchParams.set('freshness', 'pw');         // past week; local gate narrows to 72h
  url.searchParams.set('text_decorations', '0');
  url.searchParams.set('search_lang', 'en');

  let json: unknown;
  try {
    const response = await fetch(url.toString(), {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json',
      },
    });
    if (!response.ok) {
      console.error(`[braveSearch] HTTP ${response.status} for query: "${query}"`);
      return [];
    }
    json = await response.json();
  } catch (err) {
    console.error('[braveSearch] Network error:', err);
    return [];
  }

  // Type-safe extraction -- Brave response shape is not typed; access defensively.
  const data = json as Record<string, unknown>;
  const webObj = data.web as Record<string, unknown> | undefined;
  const results = (webObj?.results as unknown[]) ?? [];

  return results.map((r) => mapResult(r as Record<string, unknown>)).filter(
    (r): r is BraveSearchResult => r !== null
  );
}

function mapResult(r: Record<string, unknown>): BraveSearchResult | null {
  const title = typeof r.title === 'string' ? r.title : '';
  const url = typeof r.url === 'string' ? r.url : '';
  if (!title || !url) return null;

  // Description: prefer r.description, fallback to extra_snippets[0]
  const desc =
    (typeof r.description === 'string' && r.description) ||
    (Array.isArray(r.extra_snippets) && typeof r.extra_snippets[0] === 'string'
      ? r.extra_snippets[0]
      : '') ||
    '';

  // Source name: prefer profile.name, fallback to hostname
  const profileObj = r.profile as Record<string, unknown> | undefined;
  const profileName = typeof profileObj?.name === 'string' ? profileObj.name : '';

  const metaObj = r.meta_url as Record<string, unknown> | undefined;
  const hostname = typeof metaObj?.hostname === 'string' ? metaObj.hostname : '';
  const cleanHostname = hostname.replace(/^www\./, '');

  const sourceName = profileName || (cleanHostname ? toTitleCase(cleanHostname.split('.')[0]) : 'Unknown');
  const sourceUrl = hostname ? `https://${hostname}` : '';

  // Published date: Brave returns age as a relative or absolute string
  const ageStr = typeof r.age === 'string' ? r.age : null;
  const publishedAt = ageStr ? parseBraveAge(ageStr) : null;

  return { title, description: desc, url, publishedAt, sourceName, sourceUrl };
}

function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Parses Brave's `age` field to an ISO-8601 string.
 * Handles:
 *   - Relative: "3 days ago", "1 week ago", "2 hours ago"
 *   - Absolute: "April 1, 2026", "2026-04-01", ISO strings
 * Returns null if unparseable.
 */
function parseBraveAge(age: string): string | null {
  // Try parsing as an absolute date first
  const direct = new Date(age);
  if (!isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  // Relative pattern: "N unit(s) ago"
  const relMatch = age.match(/^(\d+)\s+(second|minute|hour|day|week|month)s?\s+ago$/i);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const now = Date.now();
    const ms: Record<string, number> = {
      second: 1000,
      minute: 60 * 1000,
      hour: 3600 * 1000,
      day: 86400 * 1000,
      week: 7 * 86400 * 1000,
      month: 30 * 86400 * 1000,
    };
    if (ms[unit] !== undefined) {
      return new Date(now - n * ms[unit]).toISOString();
    }
  }

  return null;
}
