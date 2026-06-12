/** A single entry in the offline retry queue. */
export interface QueuedWrite {
  articleId: string;
  /** 'like' | 'dislike' | 'save' for a set operation; 'cleared' for a delete */
  value: 'like' | 'dislike' | 'save' | 'cleared';
  /** ISO-8601 timestamp when the action was taken client-side */
  timestamp: string;
  /** Failed drain attempts so far (absent = 0). Items are dropped after a cap. */
  attempts?: number;
}

/** Shape returned by GET /api/feedback */
export type ServerFeedbackMap = Record<string, {
  value: 'like' | 'dislike' | 'save';
  updatedAt: string;
}>;
