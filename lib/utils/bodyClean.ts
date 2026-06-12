// Shared body-text cleanup: strips page chrome (share bars, related-article
// lists, repeated title/byline/timestamp) from extracted paragraph lists.
// Used by both lib/discovery/bodyExtractor.ts and the RSS adapter so stored
// bodyText starts at real prose and ends before recirculation junk.

/**
 * Tokens that, when a short line consists of nothing else, mark an action /
 * share bar ("Share on Facebook", "Save Article", "Read Later", "Copy link").
 */
const SHARE_TOKENS = new Set([
  'share', 'this', 'article', 'post', 'story', 'page', 'on', 'via', 'to',
  'facebook', 'twitter', 'x', 'reddit', 'linkedin', 'bluesky', 'mastodon',
  'whatsapp', 'telegram', 'pinterest', 'pocket', 'flipboard', 'tumblr',
  'email', 'print', 'copy', 'link', 'tweet', 'pin', 'sms', 'rss',
  'save', 'read', 'later', 'bookmark', 'comment', 'comments', 'follow',
  'subscribe', 'newsletter', 'sign', 'up', 'log', 'in', 'login',
]);

/** Headings that introduce trailing related-article/recirculation blocks. */
const RELATED_HEADING_RE = new RegExp(
  '^(' +
    'related(\\s+(articles?|posts?|stories|reading|content|coverage|videos?))?' +
    '|read\\s+(more|next)' +
    '|more\\s+(from|on|in)\\s+.{0,40}' +
    '|more\\s+(stories|articles|to\\s+read)' +
    '|you\\s+(might|may)\\s+also\\s+(like|enjoy)' +
    '|recommended(\\s+for\\s+you|\\s+reading)?' +
    '|further\\s+reading' +
    '|see\\s+also' +
    '|popular(\\s+(posts?|articles?|stories))?' +
    '|trending(\\s+now)?' +
    '|most\\s+(read|popular|viewed)' +
    '|up\\s+next' +
    '|next\\s+article' +
    '|previous\\s+article' +
    '|editor.?s\\s+picks' +
  ')[:.]?$',
  'i'
);

/** Video-player chrome lines. */
const VIDEO_CHROME_RE = /^featured\s+video[:.!]?$/i;

/** Byline lines near the top ("By Jane Doe", "By Jane Doe and John Smith"). */
const BYLINE_RE = /^by\s+\S+(\s+\S+){0,7}$/i;

/** Timestamp / dateline lines near the top. */
const DATELINE_RES = [
  /^(published|updated|posted|last\s+updated)(\s+(on|at))?\b.{0,40}$/i,
  /^[a-z]+\s+\d{1,2},?\s+\d{4}([\s·|,]+\d{1,2}:\d{2}.*)?$/i,   // "June 12, 2026" / "June 12, 2026 · 9:00 am"
  /^\d{1,2}\s+[a-z]+\s+\d{4}$/i,                                // "12 June 2026"
  /^\d+\s+min(ute)?s?\s+read$/i,                                // "6 min read"
];

/** How many leading paragraphs the title/byline/dateline filters apply to. */
const TOP_CHROME_WINDOW = 6;

/** Prose paragraphs end with sentence punctuation; chrome labels rarely do. */
const TERMINAL_PUNCT_RE = /[.!?:…”")\]]$/;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Title-case detector for the tail trim: trailing next-article headlines are
 * Title Cased ("Are Memories Transferable — or Edible?"), real closing prose
 * is not.
 */
function isHeadlineCase(line: string): boolean {
  if (line.length > 90) return false;
  const words = line.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  if (words.length < 3) return false;
  const caps = words.filter((w) => /^[“”"'(]?[A-Z]/.test(w)).length;
  return caps / words.length >= 0.6;
}

function isShareLine(line: string): boolean {
  if (line.length > 80) return false; // real prose paragraphs are longer
  const tokens = line.toLowerCase().split(/[\s·•|,/]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 14) return false;
  return tokens.every((t) => SHARE_TOKENS.has(t.replace(/[.:!]+$/, '')));
}

/**
 * Cleans an extracted paragraph list:
 * 1. drops share-bar and video-chrome lines anywhere;
 * 2. drops a repeated title, byline, and dateline within the first few lines;
 * 3. truncates at a trailing related-articles/recirculation heading
 *    (only looked for in the final 40% of the document).
 */
export function cleanBodyParagraphs(paragraphs: string[], title?: string): string[] {
  const normTitle = title ? normalize(title) : '';

  // Collapse consecutive duplicate lines (extraction artifacts from nested markup).
  const deduped = paragraphs.filter((l, i) => i === 0 || l !== paragraphs[i - 1]);

  let topIndex = 0; // counts surviving lines for the top-chrome window
  const kept: string[] = [];
  for (const line of deduped) {
    if (isShareLine(line) || VIDEO_CHROME_RE.test(line)) continue;

    if (topIndex < TOP_CHROME_WINDOW) {
      const normLine = normalize(line);
      const isTitleEcho =
        normTitle.length >= 12 &&
        (normLine === normTitle ||
          (normLine.length >= 20 && (normTitle.includes(normLine) || normLine.includes(normTitle))));
      // Short unpunctuated lines at the top are series tags, category labels,
      // or image credits ("The Joy of Why", "Jane Doe for Quanta Magazine").
      const isShortLabel = line.length <= 50 && !TERMINAL_PUNCT_RE.test(line);
      if (
        isTitleEcho ||
        isShortLabel ||
        BYLINE_RE.test(line) ||
        DATELINE_RES.some((re) => re.test(line))
      ) {
        continue;
      }
    }
    kept.push(line);
    topIndex++;
  }

  // Truncate trailing related-content blocks: a matching heading in the final
  // 40% of the document cuts everything from that line onward.
  let result = kept;
  const searchFrom = Math.max(3, Math.floor(kept.length * 0.6));
  for (let i = searchFrom; i < kept.length; i++) {
    if (kept[i].length <= 60 && RELATED_HEADING_RE.test(kept[i])) {
      result = kept.slice(0, i);
      break;
    }
  }

  // Tail trim: topic tags, next-article headlines, and dates left at the very
  // end (short unpunctuated lines, Title-Case headlines, pure datelines).
  let end = result.length;
  let trimmed = 0;
  while (end > 0 && trimmed < 15) {
    const line = result[end - 1];
    const chromeish =
      (line.length <= 90 && !TERMINAL_PUNCT_RE.test(line)) ||
      isHeadlineCase(line) ||
      DATELINE_RES.some((re) => re.test(line));
    if (!chromeish) break;
    end--;
    trimmed++;
  }
  return result.slice(0, end);
}
