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
