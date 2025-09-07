# Plan: Wrap Panorama (Meteor) in an Electron app

## Goals

- Keep 100% of Panorama (Meteor + React) as is.
- Provide a distributable desktop app (macOS/Windows/Linux), offline‑first.
- Solve the files problem (open/reveal without re‑downloading).
- Preserve user data across updates.

## Architecture

- Main process (Electron):
  - Starts/controls the Panorama server (Meteor in dev, Node bundle in prod).
  - Exposes OS capabilities to the UI via a secure preload (IPC).
  - Handles updates and settings persistence.
- Renderer: the existing UI (Meteor client) loaded in a BrowserWindow.
- Storage:
  - Local Mongo database (see “Database” section).
  - Uploaded files in `filesDir` (configurable). Default under `userData/files`.

## Directories to add

- `electron/`
  - `main.js` (main process)
  - `preload.js` (secure bridge, `contextIsolation: true`)
  - `builder.yml` or `electron-builder` config in `package.json`

## Development workflow

1. Run Meteor as usual:
   - `meteor run` (UI at `http://localhost:3000`)
2. Run Electron and point the window to the dev URL:
   - `BrowserWindow.loadURL('http://localhost:3000')`
3. Expose OS helpers via `preload.js`, e.g.:
   - `openFile(storedPath)` → open with default app
   - `revealInFinder(storedPath)` → show in Finder/Explorer
   - `pickFiles()` / `moveToFilesDir(paths[])` → select/move into `filesDir`
4. In the UI, optionally replace the “open” click with an IPC call (or keep web behavior and switch in prod).

## Production workflow (packaging)

Two viable options:

- Option A (simple, requires Mongo installed):
  - Build the Meteor (Node) bundle: `meteor build --directory ./.meteor-build`
  - Start the Node server from Electron with `MONGO_URL` pointing to a local MongoDB (already installed by the user).

- Option B (recommended, embed Mongo):
  - Include a `mongod` binary in `extraResources` (per platform).
  - On app startup:
    1) Create `userData/panorama-db` (dbpath) and `userData/files` (default `filesDir`).
    2) Launch `mongod --dbpath <userData/panorama-db> --port <freePort> --bind_ip 127.0.0.1`.
    3) Launch the Node bundle (`programs/server/boot.js`) with env:
       - `PORT=<freePort2>`
       - `ROOT_URL=http://localhost:<freePort2>`
       - `MONGO_URL=mongodb://127.0.0.1:<freePort>/panorama`
       - `METEOR_SETTINGS=<merged JSON>` (see Settings)
       - `PANORAMA_FILES_DIR=<userData/files>` (if not overridden)
    4) Wait for the server to be ready, then `BrowserWindow.loadURL(ROOT_URL)`.

Meteor notes: the generated bundle is a standard Node app. It does not start mongod; Electron must do it (or require an existing Mongo).

## Settings (configuration)

- Read‑only defaults: packaged in resources (e.g., `resources/settings.defaults.json`).
- User overrides: `settings.json` under `userData`.
- On startup, the main process:
  - Reads defaults + overrides and merges them.
  - Passes the result via `METEOR_SETTINGS` to the Node server.
  - Sets `PANORAMA_FILES_DIR` if present in settings, otherwise defaults to `userData/files`.

## File handling (avoid the triple copy)

- In Electron, expose via IPC:
  - `openFile(storedPath)` → open the stored file (no re‑download).
  - `revealInFinder(storedPath)` → open the folder and select the file.
  - `moveToFilesDir(paths[])` → move from Downloads into `filesDir` and call the Meteor method `files.insert` (with the local path or by reading the content).
- In the Panorama UI, replace the HTTP anchor with `window.electron.openFile(storedPath)` (or provide two actions: Preview/Open and Download).

## Electron security

- `contextIsolation: true`, `nodeIntegration: false`, `enableRemoteModule: false`.
- Minimal preload using `contextBridge` to expose bridged methods; no raw Node API in the renderer.
- Enforce a CSP in the app (keep it strict even when loading local files).

## Updates and distribution

- Build with `electron-builder`:
  - macOS: dmg + Apple notarization (requires cert)
  - Windows: nsis/msi + code signing (cert recommended)
  - Linux: AppImage/deb/rpm
- Auto‑update (optional): `autoUpdater` (GitHub Releases, S3, etc.).
- Data persistence:
  - `userData` is preserved across versions (settings, Mongo DB, caches).
  - `filesDir` lives outside app resources (never overwritten by updates).
  - Keep the same `appId`/app name to preserve the same `userData` path.

## Implementation plan (steps)

1) Create the Electron wrapper (`electron/` folder)
   - `main.js` (create BrowserWindow, spawn mongod + Node server in prod)
   - `preload.js` (expose `openFile`, `revealInFinder`, `pickFiles`, `moveToFilesDir`)
   - `electron-builder` config (targets, `extraResources` for `mongod`)

2) Meteor integration (dev)
   - Script `npm run dev:electron` that starts Meteor, then Electron targeting `http://localhost:3000`.

3) Meteor integration (prod)
   - `meteor build --directory ./.meteor-build`
   - Startup script (in `main.js`) to:
     - pick two free ports (Mongo/Node)
     - launch `mongod` (Option B) or validate `MONGO_URL` (Option A)
     - launch the Node bundle with proper env (PORT/ROOT_URL/METEOR_SETTINGS/PANORAMA_FILES_DIR)

4) UI adjustments
   - Replace (or complement) the Files “open” click with IPC `openFile`.
   - Add a “Reveal in Finder/Explorer” action.

5) Packaging & distribution
   - Add signing/notarization.
   - Configure auto‑update if desired.

## Points of attention

- MongoDB licenses/binaries: verify redistribution rights for the `mongod` binary.
- Free ports: detect/select dynamically to avoid conflicts.
- Cleanup on quit: gracefully stop the Node server and `mongod`.
- Logs and diagnostics: store logs (Electron main, Node server) under `userData/logs`.

## Next quick steps

- Decide between Option A (requires Mongo) vs Option B (embedded Mongo).
- Sketch `electron/main.js` and `preload.js` (IPC interfaces) without impacting Meteor.
- Choose the Files actions (open/reveal/move) and wire the UI.
