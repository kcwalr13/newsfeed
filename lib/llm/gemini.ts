/**
 * Gemini adapter for the LLM provider abstraction (R6-4).
 *
 * Wraps `@google/genai`. `generateStructured` uses Gemini's native JSON mode
 * (`responseMimeType: 'application/json'` + a converted `responseSchema`) and
 * `JSON.parse`s the result; `generateText` is a plain `generateContent`. The
 * `system` prompt maps to `systemInstruction` and the `user` content (already
 * `wrapUntrusted()`-fenced by the call site for sites 1–6) is passed as the
 * request `contents`.
 *
 * Activated only when `LLM_PROVIDER=gemini` (R6-5); Anthropic stays the default,
 * so adding this adapter is behavior-neutral until that flip.
 *
 * IMPORTANT: Gemini honors schema constraints (`minimum`/`maximum`/`minItems`)
 * only weakly, so the load-bearing validation stays at the call sites (range /
 * type / array-length checks) exactly as before — this adapter only parses.
 */

import { GoogleGenAI, Type, type Schema } from '@google/genai';
import type {
  LlmProvider,
  GenerateStructuredOptions,
  GenerateTextOptions,
  JsonSchema,
} from './types';
import { LlmError } from './types';
import { activeProviderConfig } from '@/lib/config/llm';

// Lazy client: constructing GoogleGenAI without GEMINI_API_KEY would talk to the
// API with no credentials; guard explicitly so a missing key fails clearly and
// early, mirroring the Anthropic adapter's getClient().
let _client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }
  if (!_client) _client = new GoogleGenAI({ apiKey });
  return _client;
}

const TYPE_MAP: Record<NonNullable<JsonSchema['type']>, Type> = {
  object: Type.OBJECT,
  array: Type.ARRAY,
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
};

/**
 * Converts our provider-agnostic `JsonSchema` to a Gemini `Schema`. Note the
 * field-type quirks: Gemini's `type` is the `Type` enum (not a lowercase
 * string), `enum` is `string[]`, and `minItems`/`maxItems` are STRINGS.
 */
function toGeminiSchema(schema: JsonSchema): Schema {
  const out: Schema = {};
  if (schema.type !== undefined) out.type = TYPE_MAP[schema.type];
  if (schema.description !== undefined) out.description = schema.description;
  if (schema.enum !== undefined) out.enum = schema.enum.map(String);
  if (schema.minimum !== undefined) out.minimum = schema.minimum;
  if (schema.maximum !== undefined) out.maximum = schema.maximum;
  if (schema.minItems !== undefined) out.minItems = String(schema.minItems);
  if (schema.maxItems !== undefined) out.maxItems = String(schema.maxItems);
  if (schema.items !== undefined) out.items = toGeminiSchema(schema.items);
  if (schema.properties !== undefined) {
    const props: Record<string, Schema> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      props[key] = toGeminiSchema(value);
    }
    out.properties = props;
  }
  if (schema.required !== undefined) out.required = schema.required;
  return out;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class GeminiProvider implements LlmProvider {
  async generateStructured<T>(opts: GenerateStructuredOptions): Promise<T> {
    // toolName/toolDescription are Anthropic concepts — ignored here.
    const { schema, system, user, maxTokens } = opts;
    try {
      const response = await getClient().models.generateContent({
        model: activeProviderConfig().model,
        contents: user,
        config: {
          systemInstruction: system,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(schema),
        },
      });
      const text = response.text;
      if (!text) {
        throw new LlmError('parse', 'Gemini returned no text for a structured request');
      }
      return JSON.parse(text) as T;
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (err instanceof SyntaxError) {
        throw new LlmError('parse', `Gemini structured output was not valid JSON: ${errMsg(err)}`, err);
      }
      throw new LlmError('api', `Gemini call failed: ${errMsg(err)}`, err);
    }
  }

  async generateText(opts: GenerateTextOptions): Promise<string> {
    const { system, user, maxTokens } = opts;
    try {
      const response = await getClient().models.generateContent({
        model: activeProviderConfig().model,
        contents: user,
        config: {
          ...(system !== undefined ? { systemInstruction: system } : {}),
          maxOutputTokens: maxTokens,
        },
      });
      const text = response.text;
      if (text === undefined || text === null) {
        throw new LlmError('parse', 'Gemini response contained no text');
      }
      return text;
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw new LlmError('api', `Gemini call failed: ${errMsg(err)}`, err);
    }
  }
}
