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

// Retry policy (FE-M2): only transient failures are worth retrying. A 4xx
// (except 429) is a poison pill — the server has rejected the payload and
// will keep rejecting it forever.
const MAX_QUEUE_ATTEMPTS = 8;
const QUEUE_ITEM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Transient = worth retrying: network error (status undefined), 5xx, or 429. */
function isTransientStatus(status: number | undefined): boolean {
  return status === undefined || status >= 500 || status === 429;
}

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
  let status: number | undefined;
  try {
    const body: Record<string, unknown> = { articleId, value };
    if (dwellSeconds !== undefined) body.dwellSeconds = dwellSeconds;
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getDeviceHeaders() },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    status = res.status;
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    if (!isTransientStatus(status)) {
      // 4xx: the server rejected this payload — retrying can never succeed.
      console.error('[feedback] server rejected write, dropping:', err);
      return;
    }
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
  let status: number | undefined;
  try {
    const res = await fetch(`/api/feedback/${encodeURIComponent(articleId)}`, {
      method: 'DELETE',
      headers: { ...getDeviceHeaders() },
    });
    if (res.ok) return;
    status = res.status;
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    if (!isTransientStatus(status)) {
      console.error('[feedback] server rejected delete, dropping:', err);
      return;
    }
    console.error('[feedback] server delete failed, queuing:', err);
    enqueue({ articleId, value: 'cleared', timestamp: new Date().toISOString() });
  }
}

/**
 * Removes one item (matched by identity) from a FRESH read of the queue, so
 * an enqueue() that happened during an in-flight await is never clobbered by
 * writing back a stale snapshot. Optionally mutates the matched item instead
 * of removing it.
 */
function updateQueueItem(item: QueuedWrite, mutate?: (q: QueuedWrite) => void): void {
  const current = readQueue();
  const idx = current.findIndex(
    (q) =>
      q.articleId === item.articleId &&
      q.value === item.value &&
      q.timestamp === item.timestamp
  );
  if (idx === -1) return;
  if (mutate) {
    mutate(current[idx]);
  } else {
    current.splice(idx, 1);
  }
  writeQueue(current);
}

/**
 * Drains the offline retry queue. Processes items oldest-first.
 * Removes each item after a 2xx response, a non-retryable 4xx (poison pill),
 * attempt-cap exhaustion, or TTL expiry. Stops on the first transient failure
 * (likely offline). Safe to call concurrently (guarded by isDraining).
 */
export async function drainQueue(): Promise<void> {
  if (typeof window === 'undefined' || isDraining) return;
  isDraining = true;
  try {
    const queue = readQueue();
    if (queue.length === 0) return;

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];

      const age = Date.now() - Date.parse(item.timestamp);
      if (Number.isFinite(age) && age > QUEUE_ITEM_TTL_MS) {
        updateQueueItem(item); // expired — drop
        continue;
      }

      let status: number | undefined;
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
        if (!res.ok) {
          status = res.status;
          throw new Error(`HTTP ${res.status}`);
        }
        updateQueueItem(item); // sent — remove
      } catch {
        if (!isTransientStatus(status)) {
          // Poison pill: the server will never accept this item — drop it so
          // it can't wedge the queue forever.
          console.error(
            `[feedback] dropping poison queue item (HTTP ${status}):`,
            item.articleId
          );
          updateQueueItem(item);
          continue;
        }
        const attempts = (item.attempts ?? 0) + 1;
        if (attempts >= MAX_QUEUE_ATTEMPTS) {
          console.error('[feedback] dropping queue item after max retries:', item.articleId);
          updateQueueItem(item);
          continue;
        }
        updateQueueItem(item, (q) => {
          q.attempts = attempts;
        });
        break; // transient failure — likely offline; retry the rest later
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
