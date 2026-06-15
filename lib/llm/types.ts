/**
 * Provider-agnostic LLM interface (R6-1).
 *
 * Two methods cover all 7 call sites in the codebase:
 *   - `generateStructured` — tool/JSON-schema output (aesthetic scorer, content
 *     evaluator, concept extractor, blind-spot prober).
 *   - `generateText` — free text (theme generator, curator notes, the offline
 *     query-bank refresh script).
 *
 * Adapters (lib/llm/anthropic.ts → R6-2, lib/llm/gemini.ts → R6-4) implement
 * this interface; `getLlm()` in lib/llm/index.ts returns the active one.
 *
 * Prompt-injection invariant (R2-M4): for the 6 in-app sites the caller MUST put
 * `UNTRUSTED_CONTENT_NOTICE` in `system` and `wrapUntrusted(...)` around the
 * scraped portion of `user`. The interface does not enforce this — it is the
 * call site's responsibility, preserved during the R6-2 refactor. (Site 7, the
 * offline query-bank script, is exempt: trusted topic labels only.)
 */

/**
 * Minimal JSON-Schema subset shared by the structured call sites. Anthropic
 * consumes it as a tool `input_schema`; Gemini maps it to a `responseSchema`.
 * Post-parse validation at each site remains load-bearing because Gemini honors
 * `minimum`/`maximum`/`minItems` only weakly.
 */
export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  description?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

export interface GenerateStructuredOptions {
  /** JSON Schema describing the structured output object. */
  schema: JsonSchema;
  /** Tool name (used by Anthropic `tool_use`; ignored by providers with native JSON mode). */
  toolName: string;
  /** Optional tool description (Anthropic tool definition; ignored by Gemini). */
  toolDescription?: string;
  /** System prompt. MUST include `UNTRUSTED_CONTENT_NOTICE` for in-app sites. */
  system: string;
  /** User content. MUST be `wrapUntrusted()`-fenced for in-app sites. */
  user: string;
  /** Output token ceiling. */
  maxTokens: number;
}

export interface GenerateTextOptions {
  /** Optional system prompt. */
  system?: string;
  /** User content. */
  user: string;
  /** Output token ceiling. */
  maxTokens: number;
}

/** The provider abstraction. Implemented by each backend adapter. */
export interface LlmProvider {
  /** Returns the parsed structured object `T`. Throws on call/parse failure. */
  generateStructured<T>(opts: GenerateStructuredOptions): Promise<T>;
  /** Returns the model's plain-text output. Throws on call failure. */
  generateText(opts: GenerateTextOptions): Promise<string>;
}

/**
 * Error thrown by provider adapters. `kind` distinguishes a transport/API
 * failure (`'api'`) from a malformed/unparseable response (`'parse'`) so call
 * sites that branch on that distinction (e.g. the content evaluator's
 * `api_error` vs `parse_error`) keep their pre-abstraction behavior.
 */
export class LlmError extends Error {
  constructor(
    public readonly kind: 'api' | 'parse',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
