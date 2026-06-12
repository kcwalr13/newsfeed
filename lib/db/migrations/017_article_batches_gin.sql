-- 017: GIN index for cross-batch article lookup (DAT-H3 / FE-C1)
-- Supports the JSONB containment query in findArticleAcrossBatches()
-- (articles @> '[{"id": "..."}]'). Performance-only: the query is correct
-- without it; at ~30 stored batches a sequential scan is already fast.

CREATE INDEX IF NOT EXISTS idx_article_batches_articles_gin
  ON article_batches USING gin (articles jsonb_path_ops);
