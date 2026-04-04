/** A single entry in the offline retry queue. */
export interface QueuedWrite {
  articleId: string;
  /** 'like' | 'dislike' for a set operation; 'cleared' for a delete */
  value: 'like' | 'dislike' | 'cleared';
  /** ISO-8601 timestamp when the action was taken client-side */
  timestamp: string;
}

/** Shape returned by GET /api/feedback */
export type ServerFeedbackMap = Record<string, {
  value: 'like' | 'dislike';
  updatedAt: string;
}>;
