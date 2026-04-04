import type { FeedbackRecord, FeedbackStore } from '../types/article';

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
export function getFeedback(articleId: string): 'like' | 'dislike' | undefined {
  return readStore()[articleId]?.value;
}

/**
 * Writes or overwrites the feedback for one article.
 * Sets updatedAt to the current time.
 */
export function setFeedback(articleId: string, value: 'like' | 'dislike'): void {
  if (typeof window === 'undefined') return;
  const store = readStore();
  const record: FeedbackRecord = { value, updatedAt: new Date().toISOString() };
  store[articleId] = record;
  writeStore(store);
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
}

/**
 * Returns the full feedback store. Useful for bulk reads in future milestones.
 */
export function getAllFeedback(): FeedbackStore {
  return readStore();
}
