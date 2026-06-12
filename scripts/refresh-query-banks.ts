#!/usr/bin/env npx ts-node
/**
 * Generates LLM-authored query banks for all discovery topics.
 * Run: npm run refresh-query-banks
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 * Overwrites data/query_banks.json and resets data/query_rotation_state.json.
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { DISCOVERY_TOPICS } from '../lib/discovery/topics';

const DATA_DIR = path.join(process.cwd(), 'data');
const BANK_PATH = path.join(DATA_DIR, 'query_banks.json');
const STATE_PATH = path.join(DATA_DIR, 'query_rotation_state.json');

const GENERATION_MODEL = 'claude-haiku-4-5-20251001';

async function generateQueriesForTopic(
  client: Anthropic,
  topicId: string,
  topicLabel: string
): Promise<string[]> {
  const prompt = `You are helping build a content discovery system that surfaces genuinely interesting long-form writing — the kind found in The Browser, The Marginalian, and Arts & Letters Daily.

For the topic "${topicLabel}", generate exactly 5 search query strings.
These queries should be written the way a master curator would search: not generic keyword phrases, but precise formulations that would surface high-signal, niche, cross-disciplinary writing from personal sites, specialist blogs, and independent publications.

Requirements:
- Each query should be 4–12 words long.
- Avoid generic terms like "articles", "blog posts", "news", "guide", "tutorial".
- Prefer formulations that would surface original thought, unusual angles, or cross-disciplinary connections.
- Vary the angle: one query might target historical depth, one might target methodology, one might target overlooked perspectives, etc.

Return a JSON array of exactly 5 strings and nothing else. No markdown, no explanation.`;

  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  try {
    // Strip markdown code fences — a fenced reply otherwise fails JSON.parse
    // and silently yields 0 queries for the topic (PIPE-L4).
    const jsonStr = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, 5).map(String);
    }
  } catch {
    // fall through to warning
  }
  console.warn(`  WARNING: Could not parse response for topic ${topicId}. Got: ${text.slice(0, 200)}`);
  return [];
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const startedAt = new Date().toISOString();
  console.log(`[refresh-query-banks] Starting at ${startedAt}`);
  console.log(`[refresh-query-banks] Topics to process: ${DISCOVERY_TOPICS.length}`);

  const result: Record<string, { queries: string[] }> = {};
  let totalQueries = 0;
  let warningTopics = 0;

  for (const topic of DISCOVERY_TOPICS) {
    process.stdout.write(`  Generating queries for "${topic.label}"... `);
    const queries = await generateQueriesForTopic(client, topic.id, topic.label);
    if (queries.length < 5) {
      console.log(`WARNING: got ${queries.length}/5 queries`);
      warningTopics++;
    } else {
      console.log(`OK (${queries.length} queries)`);
    }
    result[topic.id] = { queries };
    totalQueries += queries.length;
  }

  // Write query_banks.json atomically
  const bankData = { generated_at: startedAt, topics: result };
  const bankTmp = BANK_PATH + '.tmp';
  fs.writeFileSync(bankTmp, JSON.stringify(bankData, null, 2));
  fs.renameSync(bankTmp, BANK_PATH);
  console.log(`[refresh-query-banks] Wrote ${BANK_PATH} (${totalQueries} total queries)`);

  // Reset rotation state
  const stateData = { updated_at: startedAt, cursors: {} };
  const stateTmp = STATE_PATH + '.tmp';
  fs.writeFileSync(stateTmp, JSON.stringify(stateData, null, 2));
  fs.renameSync(stateTmp, STATE_PATH);
  console.log(`[refresh-query-banks] Reset rotation state: ${STATE_PATH}`);

  if (warningTopics > 0) {
    console.warn(`[refresh-query-banks] WARNING: ${warningTopics} topic(s) received fewer than 5 queries.`);
    console.warn(`  You may wish to manually edit ${BANK_PATH} to pad missing entries.`);
  }

  console.log(`[refresh-query-banks] Done.`);
}

main().catch((err) => {
  console.error('[refresh-query-banks] Fatal error:', err);
  process.exit(1);
});
