/**
 * Minimal type stub for node-html-parser.
 * The full package is declared in package.json (^7.1.0) and installs correctly
 * in production/CI. This stub exists only to satisfy TypeScript in environments
 * where `npm install` cannot reach the registry (e.g. offline sandboxes).
 * Keep in sync with the subset of the API used in lib/discovery/bodyExtractor.ts.
 */
declare module 'node-html-parser' {
  export class HTMLElement {
    /** Lower-cased tag name (e.g. "div", "p"). Undefined on text nodes. */
    tagName: string | undefined;
    /** Child nodes — may be text nodes (no tagName) or element nodes. */
    childNodes: HTMLElement[];
    querySelectorAll(selector: string): HTMLElement[];
    querySelector(selector: string): HTMLElement | null;
    remove(): void;
    get textContent(): string;
  }

  export function parse(html: string): HTMLElement;
}
