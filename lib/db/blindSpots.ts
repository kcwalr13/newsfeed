// DB helper functions for blind spot cluster tracking (Phase 4 Engineered Serendipity).

import { sql } from './client';

export interface BlindSpotCluster {
  id:             number;
  user_id:        string | null;
  device_id:      string;
  cluster_label:  string;
  status:         'active' | 'suppressed' | 'promoted';
  suppress_until: string | null;   // ISO-8601
  promote_until:  string | null;   // ISO-8601
  probe_count:    number;
  like_count:     number;
  dislike_count:  number;
  ignore_count:   number;
  last_probed_at: string | null;   // ISO-8601
  created_at:     string;          // ISO-8601
}

/**
 * Resets expired suppress/promote timers in a single UPDATE.
 * Sets status = 'active' where:
 *   - status = 'suppressed' AND suppress_until <= NOW()
 *   - status = 'promoted'   AND promote_until  <= NOW()
 */
export async function expireClusterTimers(
  userId: string | null,
  deviceId: string
): Promise<void> {
  await sql`
    UPDATE blind_spot_clusters
    SET status         = 'active',
        suppress_until = NULL,
        promote_until  = NULL
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
      AND (
        (status = 'suppressed' AND suppress_until <= NOW())
        OR
        (status = 'promoted'   AND promote_until  <= NOW())
      )
  `;
}

/**
 * Returns all clusters that are either active, promoted, or suppressed but with
 * an expired suppress_until. Calls expireClusterTimers() first to reset expired timers.
 */
export async function getEligibleClusters(
  userId: string | null,
  deviceId: string
): Promise<BlindSpotCluster[]> {
  await expireClusterTimers(userId, deviceId);

  const rows = await sql`
    SELECT id, user_id, device_id, cluster_label, status,
           suppress_until::text AS suppress_until,
           promote_until::text  AS promote_until,
           probe_count, like_count, dislike_count, ignore_count,
           last_probed_at::text AS last_probed_at,
           created_at::text     AS created_at
    FROM blind_spot_clusters
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
      AND status != 'suppressed'
    ORDER BY created_at ASC
  `;
  return rows as BlindSpotCluster[];
}

/**
 * Upserts a cluster row. On insert: all defaults.
 * On conflict: increments probe_count and sets last_probed_at = NOW().
 */
export async function upsertCluster(
  userId: string | null,
  deviceId: string,
  clusterLabel: string
): Promise<void> {
  await sql`
    INSERT INTO blind_spot_clusters (user_id, device_id, cluster_label)
    VALUES (${userId}, ${deviceId}, ${clusterLabel})
    ON CONFLICT (user_id, device_id, cluster_label)
    DO UPDATE SET
      probe_count    = blind_spot_clusters.probe_count + 1,
      last_probed_at = NOW()
  `;
}

/**
 * Records a like on a probe cluster: upserts the cluster, then sets status = 'promoted',
 * promote_until = NOW() + 14 days, clears suppress_until, and increments like_count.
 */
export async function recordProbeClusterPromotion(
  userId: string | null,
  deviceId: string,
  clusterLabel: string
): Promise<void> {
  await upsertCluster(userId, deviceId, clusterLabel);
  await sql`
    UPDATE blind_spot_clusters
    SET status         = 'promoted',
        promote_until  = NOW() + INTERVAL '14 days',
        suppress_until = NULL,
        like_count     = blind_spot_clusters.like_count + 1
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
      AND cluster_label = ${clusterLabel}
  `;
}

/**
 * Records a dislike on a probe cluster: upserts the cluster, then sets
 * status = 'suppressed', suppress_until = NOW() + 30 days, and increments dislike_count.
 */
export async function recordProbeClusterSuppression(
  userId: string | null,
  deviceId: string,
  clusterLabel: string
): Promise<void> {
  await upsertCluster(userId, deviceId, clusterLabel);
  await sql`
    UPDATE blind_spot_clusters
    SET status         = 'suppressed',
        suppress_until = NOW() + INTERVAL '30 days',
        dislike_count  = blind_spot_clusters.dislike_count + 1
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
      AND cluster_label = ${clusterLabel}
  `;
}

/**
 * Records an ignore on a probe cluster. Upserts first, increments ignore_count.
 * If ignore_count >= 2 after increment, sets status = 'suppressed' with a 14-day window.
 */
export async function recordProbeClusterIgnore(
  userId: string | null,
  deviceId: string,
  clusterLabel: string
): Promise<void> {
  await upsertCluster(userId, deviceId, clusterLabel);
  await sql`
    UPDATE blind_spot_clusters
    SET
      ignore_count   = blind_spot_clusters.ignore_count + 1,
      status         = CASE
        WHEN blind_spot_clusters.ignore_count + 1 >= 2 THEN 'suppressed'
        ELSE blind_spot_clusters.status
      END,
      suppress_until = CASE
        WHEN blind_spot_clusters.ignore_count + 1 >= 2 THEN NOW() + INTERVAL '14 days'
        ELSE blind_spot_clusters.suppress_until
      END
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
      AND cluster_label = ${clusterLabel}
  `;
}
