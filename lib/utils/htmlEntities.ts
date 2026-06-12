/**
 * Shared HTML entity decoder (PIPE-M7 ingest + FE-L5 display).
 *
 * Ordering matters: `&amp;` must decode LAST — decoding it first turns
 * `&amp;#8217;` into `&#8217;`, which the numeric pass then double-decodes.
 * Numeric entities use String.fromCodePoint (fromCharCode garbles astral-plane
 * characters like emoji). Unknown names and invalid code points pass through
 * unchanged.
 */

const NAMED_ENTITIES: Record<string, string> = {
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  nbsp: ' ',
  middot: '·',
  copy: '©',
  trade: '™',
  deg: '°',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeHtmlEntities(str: string): string {
  return (
    str
      // Named entities — except &amp;, which must wait until the end
      .replace(/&([a-zA-Z]+);/g, (match, name: string) =>
        name === 'amp' ? match : NAMED_ENTITIES[name.toLowerCase()] ?? match
      )
      // Numeric (decimal, then hex) — fromCodePoint for astral safety
      .replace(/&#(\d+);/g, (match, code: string) => {
        try {
          return String.fromCodePoint(parseInt(code, 10));
        } catch {
          return match;
        }
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) => {
        try {
          return String.fromCodePoint(parseInt(hex, 16));
        } catch {
          return match;
        }
      })
      // &amp; strictly last
      .replace(/&amp;/g, '&')
  );
}
