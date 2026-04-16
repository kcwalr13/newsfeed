// Query bank loader and rotation cursor for multi-query topic search.

import path from 'path';
import fs from 'fs';
import { DISCOVERY_TOPICS } from './topics';
import { appendLog } from '@/lib/pipeline/storage';

const DATA_DIR = path.join(process.cwd(), 'data');
const BANK_PATH = path.join(DATA_DIR, 'query_banks.json');
const BANK_DEFAULT_PATH = path.join(DATA_DIR, 'query_banks.default.json');
const STATE_PATH = path.join(DATA_DIR, 'query_rotation_state.json');

/**
 * Loads query banks from data/query_banks.json (copying from default on first run).
 * Returns a Map of topicId -> string[] of queries.
 */
export function loadQueryBanks(): Map<string, string[]> {
  if (!fs.existsSync(BANK_PATH)) {
    appendLog('[queryBank] query_banks.json not found; copying from default');
    fs.copyFileSync(BANK_DEFAULT_PATH, BANK_PATH);
  }

  let parsed: { topics: Record<string, { queries: string[] }> };
  try {
    parsed = JSON.parse(fs.readFileSync(BANK_PATH, 'utf-8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[queryBank] Failed to parse query_banks.json: ${msg}; using fallback queries`);
    const fallback = new Map<string, string[]>();
    for (const topic of DISCOVERY_TOPICS) {
      fallback.set(topic.id, topic.searchQueries);
    }
    return fallback;
  }

  const result = new Map<string, string[]>();
  for (const topic of DISCOVERY_TOPICS) {
    const entry = parsed.topics?.[topic.id];
    if (entry && Array.isArray(entry.queries) && entry.queries.length > 0) {
      result.set(topic.id, entry.queries);
    } else {
      appendLog(`[queryBank] Topic ${topic.id} missing from query bank; using fallback query`);
      result.set(topic.id, topic.searchQueries);
    }
  }
  return result;
}

/**
 * Reads the rotation cursor state from data/query_rotation_state.json.
 * Returns an empty Map if the file does not exist or is unparseable.
 */
export function loadRotationState(): Map<string, number> {
  if (!fs.existsSync(STATE_PATH)) {
    return new Map();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as {
      cursors: Record<string, number>;
    };
    const result = new Map<string, number>();
    for (const [topicId, cursor] of Object.entries(parsed.cursors ?? {})) {
      result.set(topicId, cursor);
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[queryBank] Warning: could not parse rotation state: ${msg}`);
    return new Map();
  }
}

/**
 * Writes the rotation cursor state to data/query_rotation_state.json atomically.
 * Logs at warn level on write error; does not throw.
 */
export function saveRotationState(state: Map<string, number>): void {
  const cursors: Record<string, number> = {};
  for (const [topicId, cursor] of state.entries()) {
    cursors[topicId] = cursor;
  }
  const data = { updated_at: new Date().toISOString(), cursors };
  const tmp = STATE_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, STATE_PATH);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[queryBank] Failed to save rotation state: ${msg}`);
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
