import type { FeedbackRecord, FeedbackStore } from '../types/article';
import type { QueuedWrite, ServerFeedbackMap } from '../types/feedback';
import { getDeviceHeaders } from '../identity/device';

/** The localStorage key under which all feedback records are stored. */
export const FEEDBACK_STORE_KEY = 'dd_feedback';

function readStore(): FeedbackStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(FEEDBACK_STORE_KEY);
    return raw ? (JSON.parse(raw) as FeedbackStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: FeedbackStore): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(FEEDBACK_STORE_KEY, JSON.stringify(store));
}

/**
 * Returns the feedback value for one article, or undefined if none recorded.
 */
export function getFeedback(articleId: string): 'like' | 'dislike' | 'save' | undefined {
  return readStore()[articleId]?.value;
}

/**
 * Writes or overwrites the feedback for one article.
 * Sets updatedAt to the current time.
 */
export function setFeedback(articleId: string, value: 'like' | 'dislike' | 'save'): void {
  if (typeof window === 'undefined') return;
  const store = readStore();
  const record: FeedbackRecord = { value, updatedAt: new Date().toISOString() };
  store[articleId] = record;
  writeStore(store);
  void serverSetFeedback(articleId, value).catch(() => {});
}

/**
 * Writes or overwrites the feedback for one article, including a dwell time.
 * Sets updatedAt to the current time. Used by the article reading view.
 */
export function setFeedbackWithDwell(
  articleId: string,
  value: 'like' | 'dislike' | 'save',
  dwellSeconds: number
): void {
  if (typeof window === 'undefined') return;
  const store = readStore();
  const record: FeedbackRecord = { value, updatedAt: new Date().toISOString() };
  store[articleId] = record;
  writeStore(store);
  void serverSetFeedback(articleId, value, dwellSeconds).catch(() => {});
}

/**
 * Removes the feedback record for one article entirely.
 * No-op if no record exists.
 */
export function clearFeedback(articleId: string): void {
  if (typeof window === 'undefined') return;
  const store = readStore();
  delete store[articleId];
  writeStore(store);
  void serverClearFeedback(articleId).catch(() => {});
}

/**
 * Returns the full feedback store. Useful for bulk reads in future milestones.
 */
export function getAllFeedback(): FeedbackStore {
  return readStore();
}

// ─── Milestone 2.5: Server persistence additions ─────────────────────────────

export const FEEDBACK_QUEUE_KEY  = 'dd_feedback_queue';
export const MIGRATION_FLAG_KEY  = 'dd_feedback_migrated';

// Concurrency guard — prevents overlapping drain runs
let isDraining = false;

function readQueue(): QueuedWrite[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(FEEDBACK_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedWrite[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedWrite[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(queue));
}

function enqueue(item: QueuedWrite): void {
  const queue = readQueue();
  queue.push(item);
  writeQueue(queue);
}

/**
 * Sends a single feedback write to the server.
 * On failure, enqueues the write for retry.
 * Fire-and-forget — not exported.
 */
async function serverSetFeedback(
  articleId: string,
  value: 'like' | 'dislike' | 'save',
  dwellSeconds?: number
): Promise<void> {
  try {
    const body: Record<string, unknown> = { articleId, value };
    if (dwellSeconds !== undefined) body.dwellSeconds = dwellSeconds;
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getDeviceHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error('[feedback] server write failed, queuing:', err);
    enqueue({ articleId, value, timestamp: new Date().toISOString() });
  }
}

/**
 * Sends a single feedback delete to the server.
 * On failure, enqueues the delete for retry.
 * Fire-and-forget — not exported.
 */
async function serverClearFeedback(articleId: string): Promise<void> {
  try {
    const res = await fetch(`/api/feedback/${encodeURIComponent(articleId)}`, {
      method: 'DELETE',
      headers: { ...getDeviceHeaders() },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error('[feedback] server delete failed, queuing:', err);
    enqueue({ articleId, value: 'cleared', timestamp: new Date().toISOString() });
  }
}

/**
 * Drains the offline retry queue. Processes items oldest-first.
 * Removes each item only after a 2xx response.
 * Stops on first failure. Safe to call concurrently (guarded by isDraining).
 */
export async function drainQueue(): Promise<void> {
  if (typeof window === 'undefined' || isDraining) return;
  isDraining = true;
  try {
    const queue = readQueue();
    if (queue.length === 0) return;

    const remaining = [...queue];
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      try {
        let res: Response;
        if (item.value === 'cleared') {
          res = await fetch(`/api/feedback/${encodeURIComponent(item.articleId)}`, {
            method: 'DELETE',
            headers: { ...getDeviceHeaders() },
          });
        } else {
          res = await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getDeviceHeaders() },
            body: JSON.stringify({ articleId: item.articleId, value: item.value }),
          });
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        remaining.shift();
        writeQueue(remaining);
      } catch {
        break;
      }
    }
  } finally {
    isDraining = false;
  }
}

/**
 * Fetches all feedback for the current device from the server.
 * Merges result into localStorage (server wins on conflict).
 * Falls back to localStorage on error.
 */
export async function loadFromServer(): Promise<FeedbackStore> {
  if (typeof window === 'undefined') return {};
  try {
    const res = await fetch('/api/feedback', { headers: { ...getDeviceHeaders() } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const serverMap: ServerFeedbackMap = await res.json();

    const store = readStore();
    for (const [articleId, record] of Object.entries(serverMap)) {
      store[articleId] = { value: record.value, updatedAt: record.updatedAt };
    }
    writeStore(store);
    return store;
  } catch (err) {
    console.error('[feedback] loadFromServer failed, using localStorage:', err);
    return getAllFeedback();
  }
}

/**
 * One-time migration: reads dd_feedback from localStorage and uploads to
 * POST /api/feedback/migrate if the dd_feedback_migrated flag is absent.
 * Sets the flag on success. No-op if flag is already set or store is empty.
 */
export async function runMigrationIfNeeded(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(MIGRATION_FLAG_KEY)) return;

  const store = getAllFeedback();
  const entries = Object.entries(store);

  if (entries.length === 0) {
    localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
    return;
  }

  const records = entries.map(([articleId, record]) => ({
    articleId,
    value: record.value,
    updatedAt: record.updatedAt,
  }));

  try {
    const res = await fetch('/api/feedback/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getDeviceHeaders() },
      body: JSON.stringify({ records }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
  } catch (err) {
    console.error('[feedback] migration failed, will retry next session:', err);
  }
}
