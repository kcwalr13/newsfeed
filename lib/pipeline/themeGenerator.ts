/**
 * Issue theme generation.
 *
 * Derives a two-word theme and one-sentence editor note for each daily issue
 * by scanning the article titles + descriptions with Claude Haiku.
 *
 * Called once per batch, result cached in article_batches.issue_metadata.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Article, DailyIssue, SourceCredit } from '@/lib/types/article';
import { appendLog } from '@/lib/pipeline/storage';
import { UNTRUSTED_CONTENT_NOTICE, wrapUntrusted } from '@/lib/utils/promptSafety';

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

interface ThemeResult {
  theme: string;       // two or three lowercase words, e.g. "quiet systems"
  themeNote: string;   // one sentence, ≤ 25 words
}

/**
 * Asks Claude Haiku to infer a unifying theme from today's article set.
 */
async function generateTheme(articles: Article[]): Promise<ThemeResult> {
  const titles = articles
    .slice(0, 7)
    .map((a, i) => `${i + 1}. "${a.title}" (${a.sourceName})`)
    .join('\n');

  const system =
    `You are an editor assembling a daily intellectual reading digest. The user message ` +
    `contains today's seven article titles. ` +
    `Respond with ONLY a JSON object in this exact shape — no markdown, no explanation:\n` +
    `{"theme":"<two or three lowercase words>","themeNote":"<one sentence under 22 words>"}\n` +
    UNTRUSTED_CONTENT_NOTICE;

  const msg = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 80,
    system,
    messages: [{ role: 'user', content: wrapUntrusted(titles) }],
  });

  const block = msg.content[0];
  if (!block || block.type !== 'text') throw new Error('No text content in response');

  const raw = block.text.trim();
  // Strip any accidental markdown code fences
  const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(jsonStr) as { theme?: string; themeNote?: string };

  if (typeof parsed.theme !== 'string' || typeof parsed.themeNote !== 'string') {
    throw new Error(`Unexpected shape: ${raw}`);
  }

  return {
    theme: parsed.theme.toLowerCase().trim().slice(0, 60),
    themeNote: parsed.themeNote.trim().slice(0, 220),
  };
}

/**
 * Builds a SourceCredit array from the displayed articles (first 7).
 */
function buildSourceCredits(articles: Article[]): SourceCredit[] {
  return articles.slice(0, 7).map((a, i) => {
    let domain = '';
    try { domain = new URL(a.articleUrl).hostname.replace(/^www\./, ''); } catch { /* ok */ }
    return {
      number: String(i + 1).padStart(2, '0'),
      source: a.sourceName,
      author: '',          // not available from RSS; left blank for now
      domain,
      url: a.articleUrl,
    };
  });
}

/**
 * Derives the volume label from the batch count (1-based).
 * Vol. I = batches 1–365, Vol. II = 366–730, etc.
 */
function volumeLabel(issueNumber: number): string {
  const vol = Math.floor((issueNumber - 1) / 365) + 1;
  const roman = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
  return `Vol.\u00A0${roman[Math.min(vol - 1, roman.length - 1)] ?? String(vol)}`;
}

/**
 * Formats a YYYY-MM-DD date string to a long-form editorial string.
 * e.g. "Saturday, April Twenty-Fifth"
 */
function formatIssueDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

/**
 * Builds or refreshes the DailyIssue metadata object for a batch.
 *
 * @param articles  - Articles in the batch (full set, not just display-7)
 * @param batchDate - YYYY-MM-DD
 * @param issueNumber - 1-based sequential issue number
 * @param arrivedAt   - ISO timestamp of when the batch was first written
 */
export async function buildIssueMetadata(
  articles: Article[],
  batchDate: string,
  issueNumber: number,
  arrivedAt: string
): Promise<DailyIssue> {
  const displayArticles = articles.slice(0, 7);

  // Default theme (fallback if LLM call fails or key is absent)
  let theme = 'today\'s selection';
  let themeNote = 'Seven pieces worth your time.';

  if (process.env.ANTHROPIC_API_KEY && displayArticles.length > 0) {
    try {
      const result = await generateTheme(displayArticles);
      theme = result.theme;
      themeNote = result.themeNote;
    } catch (err) {
      appendLog(
        `[theme] Generation failed, using defaults: ` +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }

  const d = new Date(batchDate + 'T12:00:00');
  const dateShort = d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return {
    number: issueNumber,
    date: formatIssueDateLong(batchDate),
    dateShort,
    volume: volumeLabel(issueNumber),
    theme,
    themeNote,
    count: Math.min(displayArticles.length, 7),
    arrivedAt,
    sources: buildSourceCredits(displayArticles),
  };
}
