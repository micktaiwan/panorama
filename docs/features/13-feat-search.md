# Feature: Search

Related docs:

- [Context](./00-context.md)
- [Roadmap](./01-roadmap.md)
- [Tech notes](./02-tech-notes.md)

## Goal

Provide a fast, typo‑tolerant, semantic search across all Panorama data.
Users can:

- Search with natural language; misspellings should still return relevant results.
- Ask questions in the search bar and receive contextual answers (AI mode).
- Get cross‑entity results: projects, tasks, notes, note sessions, and note lines.
- Toggle between plain semantic search and AI‑assisted search.

The rest of this document is intentionally concise; the code is the source of truth.

## Overview (code as source of truth)

- Server implementation lives here:
  - `imports/api/search/vectorStore.js` (client init, primitives, upsert/delete)
  - `imports/api/search/methods.js` (health, index, search)

How it works (very short):
- Entities → build short text → embed → upsert in Qdrant with stable ids (`toPointId(kind,id)`) and payload `{ kind, docId, projectId?, sessionId?, preview }`.
- Search → embed query (LRU cached) → Qdrant vector search → map payload back to UI objects.

## Server methods
- `qdrant.health()`
- `qdrant.indexStart()` / `qdrant.indexStatus(jobId)`
- `panorama.search(query, { projectId?, limit? })`

## Settings (minimal)
See `settings.json` keys used in code: `qdrantUrl`, `qdrantCollectionName`, `qdrantVectorSize`, `qdrantDistance`, `openai.apiKey`.

## Collection Naming Strategy

The system uses different collection naming strategies based on AI mode:

- **Remote mode**: Always uses the base collection name (e.g., `panorama` or configured `qdrantCollectionName`)
- **Local mode**: Uses model-specific collection names (e.g., `panorama_nomic_embed_text_latest`)
- **Legacy mode**: Uses base collection name when `qdrantUseLegacyCollectionName` is enabled

This ensures dimension compatibility while allowing seamless switching between local and remote models.

## Manual Reindexing

When AI mode or embedding model changes, you need to manually trigger reindexing:

- Use the "Rebuild index" button in Preferences → Qdrant
- Or call `Meteor.call('qdrant.indexStart')` programmatically
- Falls back to `search.instant` when Qdrant is unavailable in local mode

## Search Quality Test

Measures whether semantic search can find back the documents it indexed. Queries are
generated from real content (exact title, partial title, content concepts) for a sample
of notes, tasks, projects and emails, then run through `panorama.search`; the rank of the
source document in the results gives the metrics (top-3/5/10 success rate, hit rate, MRR,
average rank and score) plus automatic recommendations.

Code: `imports/api/search/generateQualityTests.js` (dataset), `runQualityTests.js`
(execution and metrics), `analyzeRecommendations.js` (recommendations),
`imports/api/searchQuality/runner.js` (orchestration and persistence).

Every run is stored in the `searchQualityRuns` collection (userId-scoped), whether it was
started from Preferences > Search Quality or from an MCP client, so runs stay comparable
before/after a fix. The stored document holds the metrics, the failure patterns, the
recommendations, up to 50 failing documents with the queries that missed them, and an
`env` snapshot (AI mode, embedding model, Qdrant collection, vector size, point count) —
without which two runs are not comparable.

Methods: `searchQuality.start(opts)` (background, returns `runId`),
`searchQuality.run(runId)`, `searchQuality.runs({limit})`, and `qdrant.qualityTest(opts)`
(synchronous, used by the UI, persisted the same way).

### Embedding model: measured, not assumed (2026-08-16)

Measured on 35 documents / 129 queries, index fully rebuilt each time:

| Model | top-3 | top-10 | MRR |
|---|---|---|---|
| text-embedding-3-small (1536) | 62.0 % | 77.5 % | 0.558 |
| text-embedding-3-large (3072) | 64.3 % | 82.2 % | 0.583 |

`large` is in place since. It costs twice the vector storage (~79 MB for 6.4k points) and about
16 cents per full reindex against 3 cents, for four to six points of recall — worth it here.

Two traps found while measuring, both fixed:

- The quality dataset, the auto-fix and the diagnosis all ignored the task trash. The indexer skips
  `deletedAt` tasks on purpose, so the test counted a correct exclusion as a search failure — and
  the auto-fix reindexed trashed tasks, making deleted content searchable again. All three now
  filter on `NOT_DELETED`. A comparison run before that fix is not usable.
- Changing the embedding model in preferences does not reach the server instantly: `PREFS_CACHE`
  is refreshed by an observer. Starting a reindex right after the write creates the collection with
  the OLD vector size while the embeddings already use the new model, and every point is rejected
  (`invalid vector: length 3072, expected 1536`). Wait until `tool_searchHealth` reports the new
  `expectedVectorSize` before touching the collection.

### Diagnose and fix loop (MCP)

The whole loop is available over MCP, so it can be run and acted upon without opening the app:

- `tool_searchHealth` — Qdrant reachable, collection, points, dimension mismatch.
- `tool_searchQualityTest` — start a run (`limit`, `maxDocsPerKind`, `kinds`, `waitMs`).
  A full run outlives a typical 60s client timeout, so it returns a `runId` to poll.
- `tool_searchQualityRun` / `tool_searchQualityRuns` — read one run (defaults to the latest) or the history.
- `tool_searchDiagnoseIndexing` — database counts vs indexed points, sampled missing documents, recommendations.
- `tool_searchAutoFix` — reindex only the documents missing from Qdrant (`dryRun` defaults to true).
- `tool_searchReindex` / `tool_searchIndexStatus` — full or per-kind rebuild, then poll the job.

Typical order: health → quality test → diagnose → auto-fix (dry run, then for real) or
reindex → quality test again and compare with the previous run.

## Roadmap: Hybrid BM25 + Vector

Goal: one `search.hybrid` that mixes lexical (BM25) and semantic (Qdrant) results.

Phase 1 (MVP lexical + fusion):
- Add a lightweight lexical indexer:
  - Option A: MongoDB text index on key fields (fast to ship).
  - Option B: In-memory MiniSearch/Lunr (BM25-like, no service to run).
- Implement `search.hybrid(query, { projectId?, limit=10, method='rrf', alpha=0.5 })`:
  - Run lexical and Qdrant searches in parallel (apply same filters).
  - Deduplicate by `docId` and fuse:
    - Default: RRF (Reciprocal Rank Fusion) with k≈60.
    - Alternative: α-mix of normalized scores.
  - Return merged, sorted results with both raw scores for debug.

Phase 2 (quality & UX):
- Tune weighting per kind; add `sessionId`/`kind` filters; expose `limit`.
- Telemetry: hit ratios, latency, cache effectiveness.

Phase 3 (engine upgrade, optional):
- Swap lexical backend to Meilisearch/Typesense if needed (typo tolerance, synonyms).
- Add synonyms/stopwords/stemming and per‑project scopes.
