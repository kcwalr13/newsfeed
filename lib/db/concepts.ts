// DB helper functions for the Phase 3 concept graph (user_concepts + user_concept_edges).

import { sql } from './client';
import type { UserConcept } from '@/lib/types/concepts';

// ── Node operations ───────────────────────────────────────────────────────────

/**
 * Batch-upserts concept nodes via unnest (one statement for all labels).
 * On insert, sets extraction_count=1 and engagement_weight to the provided
 * value. On conflict (same user+device+label), increments count and adds
 * engagementWeight. Labels must be pre-deduplicated — ON CONFLICT cannot
 * touch the same row twice within one statement.
 */
async function upsertConceptNodes(
  userId: string | null,
  deviceId: string,
  labels: string[],
  engagementWeight: number
): Promise<void> {
  if (labels.length === 0) return;
  await sql`
    INSERT INTO user_concepts (user_id, device_id, label, extraction_count, engagement_weight, last_seen_at, created_at)
    SELECT ${userId}, ${deviceId}, label, 1, ${engagementWeight}, NOW(), NOW()
    FROM unnest(${labels}::text[]) AS label
    ON CONFLICT (user_id, device_id, label)
    DO UPDATE SET
      extraction_count  = user_concepts.extraction_count + 1,
      engagement_weight = user_concepts.engagement_weight + ${engagementWeight},
      last_seen_at      = NOW()
  `;
}

/**
 * Batch-upserts co-occurrence edges via unnest (one statement for all pairs).
 * Pairs must be pre-sorted (a <= b) and deduplicated by the caller.
 * On conflict, increments co_occurrence_count.
 */
async function upsertConceptEdges(
  userId: string | null,
  deviceId: string,
  pairs: Array<[string, string]>
): Promise<void> {
  if (pairs.length === 0) return;
  const aSide = pairs.map(p => p[0]);
  const bSide = pairs.map(p => p[1]);
  await sql`
    INSERT INTO user_concept_edges (user_id, device_id, concept_a, concept_b, co_occurrence_count, last_seen_at)
    SELECT ${userId}, ${deviceId}, a, b, 1, NOW()
    FROM unnest(${aSide}::text[], ${bSide}::text[]) AS t(a, b)
    ON CONFLICT (user_id, device_id, concept_a, concept_b)
    DO UPDATE SET
      co_occurrence_count = user_concept_edges.co_occurrence_count + 1,
      last_seen_at        = NOW()
  `;
}

/**
 * Returns the top N concept nodes by engagement_weight DESC for the given identity.
 * Returns an empty array if the user has no concept nodes yet.
 */
export async function getTopConceptNodes(
  userId: string | null,
  deviceId: string,
  n: number
): Promise<UserConcept[]> {
  const rows = await sql`
    SELECT id, user_id, device_id, label, extraction_count,
           CAST(engagement_weight AS FLOAT) AS engagement_weight,
           last_seen_at::text AS last_seen_at,
           created_at::text AS created_at
    FROM user_concepts
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
    ORDER BY engagement_weight DESC
    LIMIT ${n}
  `;
  return rows as UserConcept[];
}

/**
 * Returns the count of concept nodes for the given identity.
 */
export async function countConceptNodes(
  userId: string | null,
  deviceId: string
): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM user_concepts
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
  `;
  return (rows[0] as { count: number }).count;
}

/**
 * Returns all concept nodes for the given identity (used by pruning computation).
 */
export async function getConceptNodesBatch(
  userId: string | null,
  deviceId: string
): Promise<UserConcept[]> {
  const rows = await sql`
    SELECT id, user_id, device_id, label, extraction_count,
           CAST(engagement_weight AS FLOAT) AS engagement_weight,
           last_seen_at::text AS last_seen_at,
           created_at::text AS created_at
    FROM user_concepts
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
  `;
  return rows as UserConcept[];
}

/**
 * Deletes the given concept nodes by ID, plus all associated edges, in a single
 * transaction. Edges where concept_a or concept_b matches any deleted node's label
 * are also deleted.
 */
export async function deleteConceptNodesByIds(
  userId: string | null,
  deviceId: string,
  nodeIds: number[]
): Promise<void> {
  if (nodeIds.length === 0) return;

  // Fetch labels for the nodes to be deleted (needed for edge cleanup).
  const labelRows = await sql`
    SELECT label FROM user_concepts WHERE id = ANY(${nodeIds})
  `;
  const labels = (labelRows as Array<{ label: string }>).map(r => r.label);

  if (labels.length === 0) return;

  // Delete edges + nodes atomically: sql.transaction runs both statements in
  // one non-interactive Postgres transaction, so a failure can't leave
  // orphaned edges or half-deleted nodes.
  await sql.transaction([
    sql`
      DELETE FROM user_concept_edges
      WHERE device_id = ${deviceId}
        AND (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
        AND (concept_a = ANY(${labels}) OR concept_b = ANY(${labels}))
    `,
    sql`
      DELETE FROM user_concepts
      WHERE id = ANY(${nodeIds})
    `,
  ]);
}

// ── Phase 4: Full graph reads for serendipity scoring ────────────────────────

/**
 * Returns all concept node labels for the given identity as a Set<string>.
 * Returns an empty Set if the user has no concept nodes.
 */
export async function getAllConceptLabels(
  userId: string | null,
  deviceId: string
): Promise<Set<string>> {
  const rows = await sql`
    SELECT label
    FROM user_concepts
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
  `;
  return new Set((rows as Array<{ label: string }>).map(r => r.label));
}

/**
 * Returns all concept edge pairs [concept_a, concept_b] for the given identity.
 * Returns an empty array if the user has no edges.
 */
export async function getAllConceptEdges(
  userId: string | null,
  deviceId: string
): Promise<Array<[string, string]>> {
  const rows = await sql`
    SELECT concept_a, concept_b
    FROM user_concept_edges
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
  `;
  return (rows as Array<{ concept_a: string; concept_b: string }>).map(
    r => [r.concept_a, r.concept_b]
  );
}

// ── Composite operations ──────────────────────────────────────────────────────

const CONCEPT_GRAPH_MAX_NODES = 300;
const CONCEPT_GRAPH_PRUNE_COUNT = 30;

/**
 * Prunes the 30 lowest-scoring concept nodes when the graph is at or above the
 * 300-node cap. Node score = engagement_weight * log(1 + extraction_count) * recency.
 * Recency factor: 1.0 (< 90 days), 0.5 (90–180 days), 0.25 (> 180 days).
 */
export async function pruneConceptGraph(
  userId: string | null,
  deviceId: string
): Promise<void> {
  const all = await getConceptNodesBatch(userId, deviceId);
  if (all.length < CONCEPT_GRAPH_MAX_NODES) return;

  const now = Date.now();
  const day90  = 90  * 24 * 60 * 60 * 1000;
  const day180 = 180 * 24 * 60 * 60 * 1000;

  const scored = all.map(node => {
    const ageMsRaw = now - new Date(node.last_seen_at).getTime();
    const ageMs = Math.max(0, ageMsRaw);
    const recency = ageMs <= day90 ? 1.0 : ageMs <= day180 ? 0.5 : 0.25;
    const score = node.engagement_weight * Math.log(1 + node.extraction_count) * recency;
    return { id: node.id, score };
  });

  scored.sort((a, b) => a.score - b.score);
  const toPrune = scored.slice(0, CONCEPT_GRAPH_PRUNE_COUNT).map(n => n.id);
  await deleteConceptNodesByIds(userId, deviceId, toPrune);
}

/**
 * Main entry point: checks if pruning is needed, then upserts all concept nodes
 * and edges for a new extraction event.
 *
 * concept_a/concept_b are stored in alphabetical order (enforced here).
 * engagementWeight is added to the node's cumulative engagement_weight.
 */
export async function upsertConceptGraph(
  userId: string | null,
  deviceId: string,
  concepts: string[],
  engagementWeight: number
): Promise<void> {
  if (concepts.length === 0) return;

  // Prune if at cap
  const count = await countConceptNodes(userId, deviceId);
  if (count >= CONCEPT_GRAPH_MAX_NODES) {
    await pruneConceptGraph(userId, deviceId);
  }

  // Batch-upsert nodes, then edges for every unordered pair — two statements
  // total instead of N + N·(N−1)/2 round trips (DAT-L2).
  const labels = [...new Set(concepts)];
  await upsertConceptNodes(userId, deviceId, labels, engagementWeight);

  // labels are unique, so each sorted (i < j) pair is unique too
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const [a, b] = [labels[i], labels[j]].sort() as [string, string];
      pairs.push([a, b]);
    }
  }
  await upsertConceptEdges(userId, deviceId, pairs);
}

