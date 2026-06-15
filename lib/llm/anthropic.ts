/**
 * Anthropic adapter for the LLM provider abstraction (R6-2).
 *
 * Wraps `@anthropic-ai/sdk`. `generateStructured` forces a single-tool
 * `tool_use` (the pre-abstraction pattern at every structured site) and returns
 * the parsed tool input; `generateText` returns the first text block. The model
 * id comes from `activeProviderConfig()` so call sites no longer hardcode it.
 *
 * Behavior-preserving: this produces the exact `messages.create` shape the 7
 * sites used (same system, tool name/description/input_schema, forced tool
 * choice, user content, max_tokens, model) so swapping the sites onto this
 * adapter does not change Anthropic's outputs.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LlmProvider,
  GenerateStructuredOptions,
  GenerateTextOptions,
} from './types';
import { LlmError } from './types';
import { activeProviderConfig } from '@/lib/config/llm';

// Lazy client: constructing Anthropic() with a missing ANTHROPIC_API_KEY throws,
// and doing that at module load would crash every importer. Mirrors the
// per-site getClient() guard the adapter replaces.
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  if (!_client) _client = new Anthropic();
  return _client;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class AnthropicProvider implements LlmProvider {
  async generateStructured<T>(opts: GenerateStructuredOptions): Promise<T> {
    const { schema, toolName, toolDescription, system, user, maxTokens } = opts;

    const tool: Anthropic.Tool = {
      name: toolName,
      description: toolDescription,
      input_schema: schema as Anthropic.Tool['input_schema'],
    };

    let response: Anthropic.Message;
    try {
      response = await getClient().messages.create({
        model: activeProviderConfig().model,
        max_tokens: maxTokens,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: toolName },
        messages: [{ role: 'user', content: user }],
      });
    } catch (err) {
      throw new LlmError('api', `Anthropic call failed: ${errMsg(err)}`, err);
    }

    const block = response.content.find(b => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      throw new LlmError(
        'parse',
        `Anthropic response contained no tool_use block (stop_reason=${response.stop_reason})`,
      );
    }
    return block.input as T;
  }

  async generateText(opts: GenerateTextOptions): Promise<string> {
    const { system, user, maxTokens } = opts;

    let response: Anthropic.Message;
    try {
      response = await getClient().messages.create({
        model: activeProviderConfig().model,
        max_tokens: maxTokens,
        ...(system !== undefined ? { system } : {}),
        messages: [{ role: 'user', content: user }],
      });
    } catch (err) {
      throw new LlmError('api', `Anthropic call failed: ${errMsg(err)}`, err);
    }

    const block = response.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') {
      throw new LlmError('parse', 'Anthropic response contained no text block');
    }
    return block.text;
  }
}
