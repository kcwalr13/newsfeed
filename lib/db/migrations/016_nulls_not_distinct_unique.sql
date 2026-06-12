-- 016: Make identity unique constraints NULL-safe (DAT-C2)
--
-- user_id is nullable in all per-identity tables, and plain UNIQUE treats
-- NULL ≠ NULL, so every ON CONFLICT upsert for anonymous (user_id IS NULL)
-- identities inserted a fresh duplicate row instead of updating. This
-- migration de-duplicates existing rows, then recreates the constraints as
-- UNIQUE NULLS NOT DISTINCT (requires PostgreSQL 15+; Neon qualifies).
--
-- Safe to re-run: de-dup statements no-op once clean; constraint drop/add is
-- catalog-guarded. Run as a single transaction.

BEGIN;

-- ── Step 1: De-duplicate ─────────────────────────────────────────────────────
-- Strategy mirrors how each table's upsert writes:
--   • full-state rewrites (profiles, topic weights) → keep newest row
--   • increment-style upserts (concepts, edges)     → merge SUMs into one row
--   • blind_spot_clusters → status UPDATEs hit every duplicate (matched by
--     label), so keep the oldest row, which saw all updates; reconstruct
--     probe_count as (#duplicates - 1) since the on-conflict increment never
--     fired (first insert intentionally leaves probe_count at 0).

-- user_aesthetic_profiles: keep most recently updated row per identity.
DELETE FROM user_aesthetic_profiles a
USING user_aesthetic_profiles b
WHERE a.user_id IS NOT DISTINCT FROM b.user_id
  AND a.device_id = b.device_id
  AND (a.updated_at, a.id) < (b.updated_at, b.id);

-- discovery_topic_weights: keep most recently updated row per identity+topic.
DELETE FROM discovery_topic_weights a
USING discovery_topic_weights b
WHERE a.user_id IS NOT DISTINCT FROM b.user_id
  AND a.device_id = b.device_id
  AND a.topic_id = b.topic_id
  AND (a.updated_at, a.id) < (b.updated_at, b.id);

-- user_concepts: merge duplicates (each upsert inserted count=1 / weight=delta
-- rows, so the accumulated truth is the SUM across duplicates).
WITH merged AS (
  SELECT MIN(id)                                 AS keep_id,
         SUM(extraction_count)                   AS extraction_count,
         LEAST(SUM(engagement_weight), 999.99)   AS engagement_weight,  -- NUMERIC(5,2) cap
         MAX(last_seen_at)                       AS last_seen_at,
         MIN(created_at)                         AS created_at
  FROM user_concepts
  GROUP BY user_id, device_id, label
  HAVING COUNT(*) > 1
)
UPDATE user_concepts u
SET extraction_count  = m.extraction_count,
    engagement_weight = m.engagement_weight,
    last_seen_at      = m.last_seen_at,
    created_at        = m.created_at
FROM merged m
WHERE u.id = m.keep_id;

DELETE FROM user_concepts a
USING user_concepts b
WHERE a.user_id IS NOT DISTINCT FROM b.user_id
  AND a.device_id = b.device_id
  AND a.label = b.label
  AND a.id > b.id;

-- user_concept_edges: merge co-occurrence counts the same way.
WITH merged AS (
  SELECT MIN(id)                  AS keep_id,
         SUM(co_occurrence_count) AS co_occurrence_count,
         MAX(last_seen_at)        AS last_seen_at
  FROM user_concept_edges
  GROUP BY user_id, device_id, concept_a, concept_b
  HAVING COUNT(*) > 1
)
UPDATE user_concept_edges e
SET co_occurrence_count = m.co_occurrence_count,
    last_seen_at        = m.last_seen_at
FROM merged m
WHERE e.id = m.keep_id;

DELETE FROM user_concept_edges a
USING user_concept_edges b
WHERE a.user_id IS NOT DISTINCT FROM b.user_id
  AND a.device_id = b.device_id
  AND a.concept_a = b.concept_a
  AND a.concept_b = b.concept_b
  AND a.id > b.id;

-- blind_spot_clusters: keep oldest row; probe_count := duplicates - 1.
WITH grp AS (
  SELECT MIN(id)         AS keep_id,
         COUNT(*)        AS n,
         MAX(created_at) AS last_created
  FROM blind_spot_clusters
  GROUP BY user_id, device_id, cluster_label
  HAVING COUNT(*) > 1
)
UPDATE blind_spot_clusters c
SET probe_count    = g.n - 1,
    last_probed_at = GREATEST(COALESCE(c.last_probed_at, g.last_created), g.last_created)
FROM grp g
WHERE c.id = g.keep_id;

DELETE FROM blind_spot_clusters a
USING blind_spot_clusters b
WHERE a.user_id IS NOT DISTINCT FROM b.user_id
  AND a.device_id = b.device_id
  AND a.cluster_label = b.cluster_label
  AND a.id > b.id;

-- ── Step 2: Drop the old (NULLs-distinct) unique constraints ────────────────
-- Catalog-driven so it works regardless of the auto-generated constraint names.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conrelid::regclass AS tbl, con.conname
    FROM pg_constraint con
    JOIN pg_index i ON i.indexrelid = con.conindid
    WHERE con.contype = 'u'
      AND NOT i.indnullsnotdistinct
      AND con.conrelid = ANY (ARRAY[
        to_regclass('user_aesthetic_profiles'),
        to_regclass('user_concepts'),
        to_regclass('user_concept_edges'),
        to_regclass('blind_spot_clusters'),
        to_regclass('discovery_topic_weights')
      ])
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- ── Step 3: Recreate as UNIQUE NULLS NOT DISTINCT ────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_aesthetic_profiles_identity_key') THEN
    ALTER TABLE user_aesthetic_profiles
      ADD CONSTRAINT user_aesthetic_profiles_identity_key
      UNIQUE NULLS NOT DISTINCT (user_id, device_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_concepts_identity_key') THEN
    ALTER TABLE user_concepts
      ADD CONSTRAINT user_concepts_identity_key
      UNIQUE NULLS NOT DISTINCT (user_id, device_id, label);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_concept_edges_identity_key') THEN
    ALTER TABLE user_concept_edges
      ADD CONSTRAINT user_concept_edges_identity_key
      UNIQUE NULLS NOT DISTINCT (user_id, device_id, concept_a, concept_b);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blind_spot_clusters_identity_key') THEN
    ALTER TABLE blind_spot_clusters
      ADD CONSTRAINT blind_spot_clusters_identity_key
      UNIQUE NULLS NOT DISTINCT (user_id, device_id, cluster_label);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_topic_weights_identity_key') THEN
    ALTER TABLE discovery_topic_weights
      ADD CONSTRAINT discovery_topic_weights_identity_key
      UNIQUE NULLS NOT DISTINCT (user_id, device_id, topic_id);
  END IF;
END $$;

COMMIT;
