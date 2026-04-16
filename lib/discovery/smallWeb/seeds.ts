/**
 * Starter seed URLs for the Small Web source pool.
 *
 * Two categories:
 *
 * 1. DISCOVERY DIRECTORIES — pages the crawler parses for blogroll links to
 *    discover further indie sites (ooh.directory, blogroll.org, etc.)
 *
 * 2. PERSONAL SEEDS — trusted sites supplied directly by the user. The crawler
 *    fetches their RSS/Atom feeds for articles and also follows their blogrolls
 *    to expand the network organically.
 *
 * To add a seed: append to this array. Because seedSourcesIfEmpty() only runs
 * on an empty table, run the companion SQL migration
 * (lib/db/migrations/008_seed_starter_sources.sql) to insert new entries into
 * an already-initialised database.
 */
export const SMALL_WEB_SEED_URLS: string[] = [

  // ─── Discovery Directories ─────────────────────────────────────────────────
  // These pages are parsed for blogroll links — they grow the source pool.
  'https://ooh.directory',
  'https://blogroll.org',
  'https://indieweb.org/people',
  'https://search.marginalia.nu',      // Small-Web search engine; also a content source

  // ─── Master Curators & Idea Aggregators ────────────────────────────────────
  // Sites that filter high volumes of content for enduring intellectual value.
  'https://thebrowser.com',
  'https://www.themarginalian.org',
  'https://aldaily.com',
  'https://www.3quarksdaily.com',
  'https://www.recomendo.com',
  'https://kk.org/cooltools',
  'https://webcurios.co.uk',
  'https://wmw.thran.uk',

  // ─── Digital Gardens & Personal Sites ─────────────────────────────────────
  // Independent thinkers with strong blogroll networks and original writing.
  'https://maggieappleton.com',
  'https://tomcritchlow.com',
  'https://robhaisfield.com',
  'https://blog.benjaminreinhardt.com',
  'https://nicolevanderhoeven.com',
  'https://acesounderglass.com',        // Elizabeth van Nostrand
  'https://notes.johnmavrick.com',
  'https://www.neelnanda.io',           // Neel Nanda — mechanistic interpretability
  'https://helenarosengarten.com',
  'https://www.liberaugmen.com',
  'https://mek.fyi',                    // Michael E. Karpeles (Mek)
  'https://josephnoelwalker.com',
  'https://vivek-s.com',                // V.S. Vivek
  'https://joel-becker.com',
  'https://www.alexkehayias.com',
  'https://fabien.benetou.fr',
  'https://komoroske.com',              // Alex Komoroske
  'https://alexisrondeau.me',
  'https://www.jeremykun.com',          // Math ∩ Programming
  'https://yesterweb.org',
  'https://r74n.com',
  'https://jacobfv.github.io',          // Jacob Valdez
  'https://nathanpmyoung.substack.com', // Nathan Young — forecasting / EA
  'https://www.b3ta.com',

  // ─── Literary & Creative ───────────────────────────────────────────────────
  'https://www.thediagram.com',         // Diagram — literary magazine

  // ─── Science, Technology & Deep Research ──────────────────────────────────
  // Note: these are well-known publications. They also work well as regular
  // RSS pipeline sources in data/sources.json for more reliable coverage.
  'https://www.technologyreview.com',
  'https://www.scientificamerican.com',
  'https://arxiv.org/rss/cs.AI',        // arXiv cs.AI RSS feed
  'https://huggingface.co/blog',
  'https://blog.google/technology/ai',
  'https://openai.com/news',
  'https://www.sciencenews.org',

  // ─── Needs Verification (add URL once confirmed) ──────────────────────────
  // The following sources from your list could not be confirmed with a URL.
  // Uncomment and fill in once you have the right addresses:
  //
  // 'https://???',  // Wander
  // 'https://???',  // Scaling Synthesis
  // 'https://???',  // Chromatic
  // 'https://???',  // Burny
  // 'https://???',  // The Beginning of Infinity
  // 'https://???',  // occasionally, humdrum
  // 'https://???',  // Industrial Nation
];
