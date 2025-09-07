# Panorama (Meteor + React)

Panorama is a local‑first project management & notes app built with Meteor and React. It includes projects/tasks/notes, inline editing, in‑app alarms, links, files, semantic search (Qdrant), budget imports, and reporting.

## Features

- Projects, Tasks, Notes
- Links and Files per project (files stored outside the app, served via HTTP)
- In‑app Alarms (local tab)
- Semantic Search powered by Qdrant (local vector DB)
- Budget imports (Pennylane exports + optional API)
- Reporting (LLM summaries) and Situations workspace
- Import/Export (JSON or NDJSON archive)

## Requirements

- Node and npm
- Meteor (latest)
- macOS (dev target; Linux/Windows likely fine)
- Qdrant for semantic search (Docker or native) — optional for basic UI

## Quick start (development)

```bash
# Install dependencies
npm install

# Start Meteor + Electron dev shell (opens a desktop window)
npm run dev:desktop
# or Meteor only
meteor run --settings settings.json
```

On first launch, the Onboarding screen asks for your local files directory. You can revisit Onboarding from Preferences.

## Configuration

Configuration is resolved in this order (highest priority first):

1) App Preferences (Mongo): filesDir, qdrantUrl, openaiApiKey, pennylaneBaseUrl/token
2) Environment variables: `PANORAMA_FILES_DIR`, `QDRANT_URL`, `OPENAI_API_KEY`, `PENNYLANE_TOKEN`
3) Meteor settings (`METEOR_SETTINGS` / `settings.json`)
4) Safe defaults (e.g., filesDir under home; `http://localhost:6333` for Qdrant)

Example settings (optional for dev; file is in .gitignore):

```json
{
  "qdrantUrl": "http://localhost:6333",
  "filesDir": "/path/to/panorama/files",
  "openai": { "apiKey": "sk-…" },
  "pennylane": { "baseUrl": "https://app.pennylane.com/api/external/v2/", "token": "…" }
}
```

## Qdrant (semantic search)

Run locally with Docker:

```bash
docker run --name qdrant -p 6333:6333 -p 6334:6334 qdrant/qdrant
```

Health: `http://localhost:6333/healthz`

In the app → Preferences → Qdrant:

- Check health (shows collection info and point count)
- Rebuild index (drops/recreates the collection and reindexes all docs)

## Files

- Files are uploaded to a folder outside the app (`filesDir`).
- The app serves stored copies via `/files/<storedFileName>` to avoid re‑downloads.
- Change `filesDir` anytime in Preferences.

## Export / Import

Export modal (footer):

- Export JSON (small DBs)
- Export NDJSON archive (large DBs) — includes all collections (metadata + preferences)

## Electron (desktop)

Dev wrapper:

```bash
npm run dev:desktop
```

This launches Meteor and an Electron window. See `docs/04-electron.md` for packaging notes.

## Shortcuts

- Global search: ⌘K / Ctrl+K
- Inline editing: Enter commits; Shift+Enter for newline (textarea)

## Repository notes

- `settings.json` is ignored by Git. Prefer Preferences or env vars for secrets.
- Local data lives in Meteor MongoDB; files live under `filesDir`.

## Troubleshooting

- Search returns no results: ensure Qdrant runs; set Qdrant URL in Preferences; run “Rebuild index”.
- File clicks download instead of open: ensure you open the stored copy from the app, not the original.
- GitHub push (SSH) errors: add your SSH key to GitHub and set `origin` to `git@github.com:<user>/<repo>.git`.
