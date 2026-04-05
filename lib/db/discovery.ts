// DB helpers for per-identity topic weights used by the discovery feedback loop.

import { sql } from './client';

export interface TopicWeightRow {
  user_id: string | null;
  device_id: string;
  topic_id: string;
  weight: number;
}

/** Returns all topic weight rows for an authenticated user. */
export async function getTopicWeightsForUser(userId: string): Promise<TopicWeightRow[]> {
  const rows = await sql`
    SELECT user_id, device_id, topic_id, weight::float AS weight
    FROM discovery_topic_weights
    WHERE user_id = ${userId}
  `;
  return rows as TopicWeightRow[];
}

/** Returns all topic weight rows for a device (anonymous or authenticated). */
export async function getTopicWeightsForDevice(deviceId: string): Promise<TopicWeightRow[]> {
  const rows = await sql`
    SELECT user_id, device_id, topic_id, weight::float AS weight
    FROM discovery_topic_weights
    WHERE device_id = ${deviceId}
  `;
  return rows as TopicWeightRow[];
}

/**
 * Returns a map of topic_id -> average weight across all identities.
 * Topics with no rows are not included (caller uses defaultWeight as fallback).
 */
export async function getAllTopicWeightsAveraged(): Promise<Map<string, number>> {
  const rows = await sql`
    SELECT topic_id, AVG(weight::float) AS avg_weight
    FROM discovery_topic_weights
    GROUP BY topic_id
  `;
  const map = new Map<string, number>();
  for (const row of rows as Array<{ topic_id: string; avg_weight: number }>) {
    map.set(row.topic_id, row.avg_weight);
  }
  return map;
}

/**
 * Upserts a topic weight for an identity. Clamps weight to [0.1, 2.0].
 */
export async function upsertTopicWeight(
  deviceId: string,
  topicId: string,
  weight: number,
  userId?: string | null
): Promise<void> {
  const clamped = Math.max(0.1, Math.min(2.0, weight));
  await sql`
    INSERT INTO discovery_topic_weights (device_id, user_id, topic_id, weight, updated_at)
    VALUES (${deviceId}, ${userId ?? null}, ${topicId}, ${clamped}, NOW())
    ON CONFLICT (user_id, device_id, topic_id)
    DO UPDATE SET weight = ${clamped}, updated_at = NOW()
  `;
}
