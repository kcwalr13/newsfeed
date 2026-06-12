// Query bank loader and rotation cursor for multi-query topic search.

import path from 'path';
import fs from 'fs';
import { DISCOVERY_TOPICS } from './topics';
import { sql } from '@/lib/db/client';
import { appendLog } from '@/lib/pipeline/storage';

const DATA_DIR = path.join(process.cwd(), 'data');
const BANK_PATH = path.join(DATA_DIR, 'query_banks.json');
const BANK_DEFAULT_PATH = path.join(DATA_DIR, 'query_banks.default.json');

/**
 * Loads query banks from data/query_banks.json, falling back to
 * data/query_banks.default.json, then to each topic's built-in queries.
 * Read-only: never writes to disk (the serverless filesystem is read-only
 * at runtime, so the old copy-on-first-run behavior threw in prod).
 */
export function loadQueryBanks(): Map<string, string[]> {
  let parsed: { topics: Record<string, { queries: string[] }> } | null = null;
  for (const candidate of [BANK_PATH, BANK_DEFAULT_PATH]) {
    try {
      if (!fs.existsSync(candidate)) continue;
      parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog(`[queryBank] Failed to read ${path.basename(candidate)}: ${msg}`);
    }
  }
  if (!parsed) {
    appendLog('[queryBank] No query bank file readable; using built-in topic queries');
  }

  const result = new Map<string, string[]>();
  for (const topic of DISCOVERY_TOPICS) {
    const entry = parsed?.topics?.[topic.id];
    if (entry && Array.isArray(entry.queries) && entry.queries.length > 0) {
      result.set(topic.id, entry.queries);
    } else {
      if (parsed) {
        appendLog(`[queryBank] Topic ${topic.id} missing from query bank; using fallback query`);
      }
      result.set(topic.id, topic.searchQueries);
    }
  }
  return result;
}

/**
 * Reads rotation cursors from the query_rotation_state table (migration 015).
 * Returns an empty Map if the table is missing or the read fails — each topic
 * then starts from the beginning of its bank, matching the old behavior when
 * the state file was absent.
 */
export async function loadRotationState(): Promise<Map<string, number>> {
  try {
    const rows = await sql`SELECT topic_id, cursor FROM query_rotation_state`;
    const result = new Map<string, number>();
    for (const row of rows as Array<{ topic_id: string; cursor: number }>) {
      result.set(row.topic_id, row.cursor);
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[queryBank] Could not load rotation state from DB (migration 015 applied?): ${msg}`);
    return new Map();
  }
}

/**
 * Persists rotation cursors to the query_rotation_state table.
 * Logs and returns on failure (e.g. migration 015 not yet applied); never throws.
 */
export async function saveRotationState(state: Map<string, number>): Promise<void> {
  if (state.size === 0) return;
  try {
    for (const [topicId, cursor] of state.entries()) {
      await sql`
        INSERT INTO query_rotation_state (topic_id, cursor, updated_at)
        VALUES (${topicId}, ${cursor}, NOW())
        ON CONFLICT (topic_id)
        DO UPDATE SET cursor = ${cursor}, updated_at = NOW()
      `;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[queryBank] Failed to save rotation state to DB: ${msg}`);
  }
}

/**
 * Selects the next two queries from a query bank using the rotation cursor.
 * Returns the selected queries and the new cursor position.
 */
export function selectNextTwoQueries(
  queries: string[],
  cursor: number
): { selected: string[]; newCursor: number } {
  const N = queries.length;
  if (N === 0) return { selected: [], newCursor: cursor };
  if (N === 1) {
    appendLog('[queryBank] Warning: topic has only 1 query in bank; running single query');
    return { selected: [queries[0]], newCursor: 0 };
  }
  const i1 = (cursor + 1) % N;
  const i2 = (cursor + 2) % N;
  return { selected: [queries[i1], queries[i2]], newCursor: i2 };
}
