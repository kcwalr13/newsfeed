-- Migration 008: Insert starter seed sources into small_web_sources
-- Run this after 007_small_web_sources.sql if the table already has rows.
-- seedSourcesIfEmpty() only fires on an empty table, so new seeds added to
-- lib/discovery/smallWeb/seeds.ts must be back-filled here manually.
--
-- Safe to re-run: ON CONFLICT DO NOTHING skips any URL already present.

INSERT INTO small_web_sources (url, status, discovered_via) VALUES

  -- ── Discovery Directories ──────────────────────────────────────────────────
  ('https://ooh.directory',             'active', 'seed'),
  ('https://blogroll.org',              'active', 'seed'),
  ('https://indieweb.org/people',       'active', 'seed'),
  ('https://search.marginalia.nu',      'active', 'seed'),

  -- ── Master Curators & Idea Aggregators ────────────────────────────────────
  ('https://thebrowser.com',            'active', 'seed'),
  ('https://www.themarginalian.org',    'active', 'seed'),
  ('https://aldaily.com',               'active', 'seed'),
  ('https://www.3quarksdaily.com',      'active', 'seed'),
  ('https://www.recomendo.com',         'active', 'seed'),
  ('https://kk.org/cooltools',          'active', 'seed'),
  ('https://webcurios.co.uk',           'active', 'seed'),
  ('https://wmw.thran.uk',              'active', 'seed'),

  -- ── Digital Gardens & Personal Sites ──────────────────────────────────────
  ('https://maggieappleton.com',        'active', 'seed'),
  ('https://tomcritchlow.com',          'active', 'seed'),
  ('https://robhaisfield.com',          'active', 'seed'),
  ('https://blog.benjaminreinhardt.com','active', 'seed'),
  ('https://nicolevanderhoeven.com',    'active', 'seed'),
  ('https://acesounderglass.com',       'active', 'seed'),
  ('https://notes.johnmavrick.com',     'active', 'seed'),
  ('https://www.neelnanda.io',          'active', 'seed'),
  ('https://helenarosengarten.com',     'active', 'seed'),
  ('https://www.liberaugmen.com',       'active', 'seed'),
  ('https://mek.fyi',                   'active', 'seed'),
  ('https://josephnoelwalker.com',      'active', 'seed'),
  ('https://vivek-s.com',               'active', 'seed'),
  ('https://joel-becker.com',           'active', 'seed'),
  ('https://www.alexkehayias.com',      'active', 'seed'),
  ('https://fabien.benetou.fr',         'active', 'seed'),
  ('https://komoroske.com',             'active', 'seed'),
  ('https://alexisrondeau.me',          'active', 'seed'),
  ('https://www.jeremykun.com',         'active', 'seed'),
  ('https://yesterweb.org',             'active', 'seed'),
  ('https://r74n.com',                  'active', 'seed'),
  ('https://jacobfv.github.io',         'active', 'seed'),
  ('https://nathanpmyoung.substack.com','active', 'seed'),
  ('https://www.b3ta.com',              'active', 'seed'),

  -- ── Literary & Creative ───────────────────────────────────────────────────
  ('https://www.thediagram.com',        'active', 'seed'),

  -- ── Science, Technology & Deep Research ───────────────────────────────────
  ('https://www.technologyreview.com',  'active', 'seed'),
  ('https://www.scientificamerican.com','active', 'seed'),
  ('https://arxiv.org/rss/cs.AI',       'active', 'seed'),
  ('https://huggingface.co/blog',       'active', 'seed'),
  ('https://blog.google/technology/ai', 'active', 'seed'),
  ('https://openai.com/news',           'active', 'seed'),
  ('https://www.sciencenews.org',       'active', 'seed')

ON CONFLICT (url) DO NOTHING;
