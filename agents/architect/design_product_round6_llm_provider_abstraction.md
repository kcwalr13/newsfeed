# Design — Round 6: LLM Provider Abstraction (Claude ↔ Gemini) + go free-tier

**Status:** Plan — ready for implementation
**Author:** Review/PM pass (Cowork), 2026-06-15
**Source:** Kyle wants (a) zero extra LLM spend and (b) infrastructure to swap models/providers as new ones ship.
**Decision (Kyle):** after the abstraction lands, the **active provider = Gemini 2.x Flash (free tier)**.
Backlog: `agents/review/REVIEW_TRACKER.md` → ROUND 6.

---

## 1. Goal & shape

Today the app is hard-wired to the Anthropic API (`@anthropic-ai/sdk`, key `ANTHROPIC_API_KEY`) at **7 call
sites**, and that account is out of credits (R5-C3). Round 6 introduces a **provider-abstraction layer** so the
LLM backend is chosen by config, adds a **Gemini** adapter, and switches production to **Gemini Flash (free
tier)** — $0 spend — while keeping the Anthropic adapter a one-env-var flip away.

**The 7 call sites** (all use `LLM_MODEL` from `lib/config/llm.ts`; all structured sites force Anthropic
`tool_use`):

| # | Module | Type | Output |
|---|--------|------|--------|
| 1 | `lib/discovery/aestheticScorer.ts` | STRUCTURED | 6 aesthetic dims (number 1–5) |
| 2 | `lib/discovery/llmEvaluator.ts` | STRUCTURED | 5 editorial scores (int 1–5) |
| 3 | `lib/discovery/conceptExtractor.ts` | STRUCTURED | `concepts: string[]` |
| 4 | `lib/pipeline/blindSpotProber.ts` | STRUCTURED | clusters `{label, members[]}[]` |
| 5 | `lib/pipeline/themeGenerator.ts` | TEXT (JSON-in-text) | `{theme, themeNote}` |
| 6 | `lib/pipeline/curatorNoteGenerator.ts` | TEXT | 1–2 sentence note |
| 7 | `scripts/refresh-query-banks.ts` | TEXT (JSON-in-text) | `string[]` (offline; **no** `wrapUntrusted`) |

**Invariant to preserve everywhere:** `UNTRUSTED_CONTENT_NOTICE` stays in the `system` prompt and
`wrapUntrusted(...)` stays on user content for sites 1–6 (the prompt-injection defense, R2-M4). Site 7 is
exempt (trusted topic labels). Keep all the existing **post-parse validation** (range/type/array checks) —
Gemini honors schema constraints (`minimum`/`maximum`/`minItems`) only weakly, so client-side validation is
load-bearing.

---

## 2. The hard part: Gemini free-tier rate limits vs. call volume

A full pipeline run is **~70–90 LLM calls**, dominated by discovery eval. Current throttling is per-loop
concurrency (4) + an **unbounded** curator-note fan-out — which bursts **8–24× over** Gemini free's ceiling.

| Stage | Calls/run | Current throttle |
|-------|-----------|------------------|
| Discovery eval (site 2) | ≤ **40** (`DISCOVERY_MAX_EVAL_CANDIDATES`) | `DISCOVERY_LLM_CONCURRENCY=4` |
| Aesthetic scoring (site 1) | ≤ 20 | `PIPELINE_LLM_CONCURRENCY=4` |
| Concept extraction (site 3) | ≤ 20 | `PIPELINE_LLM_CONCURRENCY=4` |
| Blind-spot (site 4) | 1 | — |
| Theme (site 5) / curator notes (site 6) | 1 / ≤7 | feed-request path; **6 is unbounded** |

**Gemini free tier (verify at build — values move):** 2.0 Flash ≈ **15 RPM / 1M TPM**, 2.5 Flash ≈
**10 RPM / 250k TPM**, plus a **daily RPD cap** (~hundreds–1,500). At 15 RPM, 40 discovery evals alone take
~2.7 min — **over the ~150s discovery budget** (`PIPELINE_WALL_CLOCK_BUDGET_MS=270s` minus the 120s
post-discovery reserve). So **a full run cannot complete under the free tier within today's budget unchanged.**

**Strategy (do all three):**
1. **A shared global rate limiter** (token bucket at the provider's RPM) is the real throttle — the per-loop
   concurrency numbers become subordinate. This is the critical new piece.
2. **Cut call volume to fit:** for Gemini, lower `DISCOVERY_MAX_EVAL_CANDIDATES` (e.g. 40 → ~15) and rely on
   skip-already-scored (PIPE-M5) + the per-run cap; this trades a little discovery breadth for fitting the
   minute/budget. Use **Gemini 2.0 Flash** (15 RPM, 1M TPM) over 2.5 Flash for the pipeline volume.
3. **Degrade gracefully** (already true): if the budget cuts discovery short, the batch still writes
   (DAT-H2) — just thinner. Watch the **daily RPD** cap: a `forceOverwrite` refresh re-spends, so keep
   scoring cached and avoid gratuitous refreshes.

**Optional bigger win (R6-7, phase 2):** **batch** the high-volume structured calls — score N articles per
request (one prompt → an array of N score objects). That collapses ~40 discovery evals into ~4–8 calls and
~20 aesthetic into ~2–4, which fits the free tier comfortably *and* improves latency/cost on any provider.
It's a meaningful refactor of the scorer prompts/parsers, so it's phased after the abstraction works.

---

## 3. The abstraction (`lib/llm/`)

**Interface — two methods cover all 7 sites:**
```ts
export interface LlmProvider {
  generateStructured<T>(opts: {
    schema: JsonSchema; toolName: string;   // toolName for Anthropic; ignored by Gemini
    system: string; user: string;           // user already wrapUntrusted()-fenced
    maxTokens: number;
  }): Promise<T>;
  generateText(opts: { system?: string; user: string; maxTokens: number }): Promise<string>;
}
```

**Files to add:**
- `lib/config/llm.ts` — extend: `LLM_PROVIDER` (`'anthropic' | 'gemini'`, from env, default `'anthropic'` for
  back-compat), and a per-provider table `{ model, rpm, maxConcurrency, dailyCap? }`. Keep `LLM_MODEL` as the
  Anthropic default.
- `lib/llm/anthropic.ts` — wraps `new Anthropic()`; `generateStructured` builds
  `tools:[{name,input_schema:schema}] + tool_choice:{type:'tool',name}` and does the `content.find(tool_use)`
  parse; `generateText` reads `content[0].text`. Carries the lazy-singleton + key-guard.
- `lib/llm/gemini.ts` — `@google/genai`; `generateStructured` →
  `generationConfig:{ responseMimeType:'application/json', responseSchema:<converted schema> }` then
  `JSON.parse`; `generateText` → plain `generateContent`; map `system` → `systemInstruction`.
- `lib/llm/limiter.ts` — one **shared token-bucket limiter** keyed by the active provider's RPM, wrapping
  every call from both adapters. The single most important new component (see §2).
- `lib/llm/index.ts` — `getLlm(): LlmProvider` factory by `LLM_PROVIDER`.

**Schema → Gemini mapping** (keep post-parse validation in all cases):
- Site 1 `score_aesthetic`: object of 6 `NUMBER` props.
- Site 2 `score_article`: 5 `INTEGER` props; keep composite-mean computation client-side.
- Site 3 `extract_concepts`: `ARRAY<STRING>`; keep min/max-length post-filter.
- Site 4 `group_concepts`: nested `ARRAY<OBJECT{cluster_label:STRING, member_concepts:ARRAY<STRING>}>`.
- Sites 5 & 7 (JSON-in-text): may optionally become `generateStructured` on Gemini (real JSON mode) to drop the
  fragile fence-strip + `JSON.parse` — optional.

**Refactor each site to the interface** (remove `import Anthropic`/`new Anthropic()`/`.messages.create`),
preserving prompt-safety: aestheticScorer, llmEvaluator (keep its provider-injection seam for tests),
conceptExtractor, blindSpotProber → `generateStructured`; themeGenerator, curatorNoteGenerator,
refresh-query-banks → `generateText`. Route the **unbounded** curator-note fan-out
(`generateMissingCuratorNotes`) through the shared limiter.

---

## 4. Workstream / sequencing

Order is chosen so the gate stays green at every step and the risky provider-switch comes last.

- **R6-1 — Provider interface + config.** `lib/llm/types.ts`, `lib/llm/index.ts`, extend `lib/config/llm.ts`
  (`LLM_PROVIDER` + per-provider table). No behavior change yet.
- **R6-2 — Anthropic adapter + refactor all 7 sites to the interface.** Anthropic stays the active provider →
  **behavior-preserving**; verify the gate is green and (if any credits) outputs are unchanged. This de-risks
  the whole round: the abstraction lands with zero behavior change before Gemini enters.
- **R6-3 — Shared rate limiter** (`lib/llm/limiter.ts`); wire all calls through it; make per-loop concurrency
  subordinate to it. Default to Anthropic's effectively-unlimited rate so behavior is unchanged until Gemini.
- **R6-4 — Gemini adapter** (`lib/llm/gemini.ts`, `@google/genai`); schema mapping per site; `system →
  systemInstruction`; preserve fence/notice. Add `GEMINI_API_KEY` env.
- **R6-5 — Go live on Gemini free + fit the budget.** Set `LLM_PROVIDER=gemini`, model = Gemini 2.0 Flash,
  limiter at ~15 RPM; lower `DISCOVERY_MAX_EVAL_CANDIDATES` (→ ~15) and concurrency so a run fits RPM + the
  wall-clock budget; confirm graceful degradation when it doesn't.
- **R6-6 — Docs + ops.** `.env.example`, README, ARCHITECTURE: new env (`LLM_PROVIDER`, `GEMINI_API_KEY`), the
  free-tier **training-data caveat**, the **taste-model recalibration** note (below), the degraded-mode
  behavior, and **Kyle's action**: create a free key at aistudio.google.com → set `GEMINI_API_KEY` +
  `LLM_PROVIDER=gemini` in Vercel.
- **R6-7 — (Optional, phase 2) batch the high-volume structured calls** (N articles per request) to reclaim
  throughput/quality under the free tier. Defer; the round works without it (just thinner discovery on busy days).

---

## 5. Caveats to document (R6-6) & risks

- **Privacy / training data.** Gemini **free-tier** prompts may be used by Google to improve products. The app
  sends **article text** (public) + a **taste digest** (your concept labels / tone) to the curator-note and
  scoring calls. For a private single-user app this is likely acceptable, but it must be **documented**, and
  it's a reason you might keep the Anthropic adapter for anything sensitive.
- **Taste-model recalibration.** The aesthetic scores in `article_aesthetic_scores` were produced by Claude
  Haiku; Gemini Flash will score on a slightly different internal scale, so the centroid sits in a *mixed*
  space for a while. Options: (a) accept the drift (old scores age out as feedback accrues), or (b) a one-time
  re-score of recent articles after the switch. Recommend (a) + a note; revisit if rankings feel off.
- **Quality.** Gemini Flash structured output is good but not identical to Haiku's; the load-bearing
  post-parse validation already guards malformed output (a failed structured call degrades exactly like
  today's — skip + rank by source).
- **Discovery thinness on the free tier.** The RPM ceiling means fewer eval candidates/run until R6-7 batching;
  expect slightly less discovery breadth on busy days. Acceptable per Kyle's $0 goal.
- **Daily RPD cap.** One cron/day is fine; avoid repeated `forceOverwrite` refreshes (each re-spends the cap).

**Out of scope:** multi-provider routing per-call-site (e.g. Gemini for scoring, Claude for notes); a
local/Agent-SDK pipeline; embeddings. The interface leaves room for all of these later.
