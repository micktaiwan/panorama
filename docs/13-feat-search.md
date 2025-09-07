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
- Get cross‑entity results: projects, tasks, notes, note sessions, note lines, and alarms.
- Toggle between plain semantic search and AI‑assisted search.

The rest of this document designs the feature and defines the implementation plan.

## Current implementation (MVP)

- Server
  - Qdrant client via `@qdrant/js-client-rest`.
  - Collection name: `panorama` (configurable), vector size: 1536, distance: Cosine.
  - Deterministic UUID point ids from `kind:id` using SHA‑1.
  - Backfill indexer (`qdrant.indexStart`) collects Projects, Tasks, Notes, Note Sessions, Note Lines, Alarms and upserts in batches with payload:
    - `{ kind, docId, projectId?, sessionId?, preview }` where `preview` is a short text snippet used for UI.
  - Health method: `qdrant.health`.
  - Search method: `panorama.search(query, { projectId?, limit? })` → `{ results: Array<{score, kind, projectId, id, sessionId?, text}>, cachedVector: boolean, cacheSize: number }`.
  - Query vector LRU cache (in‑memory): dedupes in‑flight requests; key is normalized query; returns `cachedVector` and `cacheSize`.
  - DEBUG embeddings mode for development: generates deterministic pseudo‑vectors to avoid external calls. When disabled, uses OpenAI `text-embedding-3-small`.
  - Index action drops and recreates the collection before reindexing (clean rebuild) with a confirmation dialog in the UI.

- UI
  - Global search modal (⌘K/Ctrl+K) available from anywhere.
  - `SearchBar` + `SearchResults` components with external CSS (no inline styles).
  - Live hints:
    - Cached indicator: green dot if query vector comes from cache; red dot otherwise. Tooltip shows cache size.
    - Spinner on the right while the search is running.
    - “Stale” state: when the user edits the query, current results are kept but visually grayed until a new search completes; keyboard navigation remains active.
  - Keyboard UX: Arrow Down selects first result and moves; Enter activates the selected result. If results are present and the query hasn’t changed, pressing Enter again opens the first/selected result.
  - Results are clickable and route to:
    - project → `#/projects/:projectId`
    - task → `#/projects/:projectId`
    - note → `#/projects/:projectId`
    - line → `#/sessions/:sessionId`
    - session → `#/sessions/:sessionId`
    - alarm → `#/alarms`

## Decision: Use Qdrant for Semantic Search in Panorama

We decided to use **Qdrant** as the vector database for the Panorama project (our internal project management tool). Panorama is a standalone Meteor.js app (Node.js, MongoDB) and uses Qdrant for all semantic search needs.

- Panorama uses **Qdrant** (Docker or binary) as a dedicated vector store.
- Qdrant holds embeddings for projects, tasks, notes, note sessions, note lines, and alarms (Panorama entities).

- **Setup Instructions**:
  - **Install Qdrant**: Ensure Qdrant is installed and running. You can use Docker for a quick setup:

    ```bash
    docker run -p 6333:6333 qdrant/qdrant
    ```

  - **Create a Collection**: Use the Qdrant client to create a collection in Qdrant for storing embeddings. This can be done using the `@qdrant/js-client-rest` package.
  - **Example Code (ESM)**:

    ```javascript
    import { QdrantClient } from '@qdrant/js-client-rest';

    import { Meteor } from 'meteor/meteor';
    const client = new QdrantClient({ url: Meteor.settings.qdrantUrl || 'http://localhost:6333' });

    async function setupCollection() {
      await client.createCollection('panorama', {
        vectors: {
          size: 1536, // match your embedding model dimension
          distance: 'Cosine'
        }
      });
    }

    setupCollection().catch(console.error);
    ```
  
  - **Upsert and Search Examples**:
    - **Upsert**: Add vectors to the collection.

      ```javascript
      async function upsertData() {
        // vector must have the exact length configured in the collection (e.g., 1536)
        const points = [
          { id: 'proj:123', vector: new Array(1536).fill(0).map((_, i) => Math.sin(i) * 0.01), payload: { projectId: '123', kind: 'project' } },
          { id: 'task:456', vector: new Array(1536).fill(0).map((_, i) => Math.cos(i) * 0.01), payload: { projectId: '123', kind: 'task' } }
        ];
        await client.upsert('panorama', { points });
      }

      upsertData().catch(console.error);
      ```

    - **Search**: Query the collection for similar vectors.

    ```javascript
    async function search(queryVector) {
      const results = await client.search('panorama', {
        vector: queryVector, // length must equal collection vector size
        limit: 5,
        filter: { must: [{ key: 'projectId', match: { value: '123' } }] } // optional filters
      });
      console.log('Search results:', results);
    }

    search(new Array(1536).fill(0)).catch(console.error);
    ```

  - **Settings**: Ensure `qdrantUrl` is set in `settings.json` and Meteor is started with `--settings`.
  
    ```json
    {
      "qdrantUrl": "http://localhost:6333"
    }
    ```

  - Use the official client: `@qdrant/js-client-rest`.
  - Meteor accesses Qdrant over HTTP (no tight coupling).

### Embeddings: model choice and indexing guidelines

- Recommended model (MVP): OpenAI `text-embedding-3-small` (1536 dims)
  - Good quality/price, low latency, multilingual enough for Panorama.
  - Set Qdrant collection `vectors.size = 1536`.
- When to upgrade: `text-embedding-3-large` (3072 dims) if recall/robust multilingual is a priority (higher cost/size).
- Local/offline alternative: `bge-m3` (1024 dims, multilingual) or `bge-small-en-v1.5` (384 dims) via sentence-transformers; update Qdrant size accordingly.

Indexing guidelines

- Chunking
  - Break long notes/text into chunks of ~512–1000 characters, with ~10–20% overlap.
  - Keep one vector per short item: project title/description, task title, alarm title, note line.
- Payload & ids
  - Use stable ids, e.g., `kind:id` (`task:abc123`), and payload `{ projectId, kind }` to filter/group results.
- Caching & batching
  - Cache embeddings by content hash to avoid rework.
  - Batch upserts to Qdrant; keep requests small (e.g., 64–256 points per batch).
- Updates
  - Re-embed on content change; mark old vectors for deletion or overwrite in place by stable id.
  - Run backfills in background jobs (batches), idempotent with progress markers.

- **Architecture**:
  - Panorama remains a Meteor monolith; Qdrant is a **separate service** running locally or in Docker.
  - Meteor server uses `Meteor.defer()` or workers to offload embedding generation and vector upserts.
  - Abstraction layer: implement a `VectorStore` interface so we can swap Qdrant for another backend later if needed.
  - **Backfill and Idempotency**: run embedding backfills in small batches; avoid blocking Meteor methods; store progress to re-run safely; keep Qdrant vector size in sync with the embedding model.

- **Dev workflow**:
  - Treat Qdrant like a microservice: local dev uses `docker-compose`; production deploy gets its own VM/volume with snapshots enabled.
  - Update README to include Qdrant installation and usage via Meteor `settings.json` (key `qdrantUrl`).

### Settings

Example `settings.json` keys used by search:

```json
{
  "qdrantUrl": "http://localhost:6333",
  "qdrantCollectionName": "panorama",
  "qdrantVectorSize": 1536,
  "qdrantDistance": "Cosine",
  "openai": { "apiKey": "..." }
}
```

Notes:

In development, DEBUG mode may be enabled in code to avoid OpenAI calls
when using real embeddings, ensure `openai.apiKey` is set and vector size
matches the chosen model.

## Live updates: design and reusable helpers

Goal: keep Qdrant in sync for all entities without duplicating logic in every `methods.js`.

- VectorStore abstraction (server)
  - `toPointId(kind, id)` → stable key `kind:id` (e.g., `task:abc123`).
  - `makePreview(text, max=180)` → short, normalized snippet.
  - `embedText(text)` / `getQueryVectorCached(query)` (query‑time LRU already implemented).
  - `upsertDoc({ kind, id, text, projectId=null, sessionId=null, extraPayload={} })` → compute embedding, build payload `{ kind, docId, projectId?, sessionId?, preview, ...extraPayload }`, upsert to Qdrant.
  - `deleteDoc(kind, id)` → remove the corresponding point.

- Kind registry
  - A single map describes how to derive text/payload for each entity kind:
    - project: `text = name + ' ' + description`, payload `{ projectId: _id }`
    - task: `text = title`, payload `{ projectId }`
    - note: `text = title + ' ' + content`, payload `{ projectId }`
    - session: `text = name + ' ' + aiSummary`, payload `{ projectId }`
    - line: `text = content`, payload `{ sessionId }`
    - alarm: `text = title`, payload `{}`
  - Used by both the backfill and live updates so there is one source of truth.

- Update rules (applies to all collections)
  - Create/Update: compute `text` and `payload` via registry, then `upsertDoc`. No need to delete first (Qdrant upsert overwrites vector/payload for the point ID).
  - Delete: call `deleteDoc` for `kind:id`.
  - ID change (rare): delete old point then upsert with new ID.

- Concurrency & reliability
  - Run embedding/upsert in `Meteor.defer()` (or a small worker pool); never block the method’s response.
  - Log errors with `console.error` (no silent catches); consider a retry queue for transient failures.
  - Keep batch size moderate for backfills (64–256 points) and validate vector size.

## Implementation TODO

- [x] Setup Qdrant collection `panorama` (vectors.size=1536, distance=Cosine)
  - [x] Add `qdrantUrl` to `settings.json` and run with `--settings`
  - [x] Server init ensures collection exists; Index action now drop+recreate (clean rebuild)
- [x] Generate embeddings (backfill, batched, idempotent)
  - [x] Projects: title + description
  - [x] Tasks: title
  - [x] Notes: title + content
  - [x] Note Sessions: name + AI summary
  - [x] Note Lines: content (payload includes `sessionId`)
  - [x] Alarms: title
  - [x] Upsert to Qdrant with payload `{ projectId, kind, docId, preview }`
- [x] Meteor method `panorama.search` (Qdrant query, optional filter by projectId)
- [x] Query vector LRU cache (server): returns `cachedVector` and `cacheSize`
- [x] Search UI
  - [x] Global Cmd+K modal, `SearchBar` + `SearchResults`
  - [x] Clickable rows → navigate to entity routes
  - [x] Keyboard navigation (↓ to select, Enter to open)
  - [x] Cached indicator (green/red + tooltip with cache size)
  - [x] Spinner during search
  - [x] “Stale results” gray state while editing input
- [x] Implement "Live updates: design and reusable helpers" (VectorStore helpers + hooks in Projects/Tasks/Notes/NoteSessions/NoteLines/Alarms)
  - [x] On entity create/update/delete, re-embed and upsert/delete point
- [ ] Performance & quality
  - [ ] Lexical fallback (MiniSearch/Meili) for acronyms/IDs
  - [ ] Quantization experiments (optional)
- [ ] Testing & validation
  - [ ] Unit tests for query shaping, caching, and result mapping
  - [ ] Manual evaluation on real data
