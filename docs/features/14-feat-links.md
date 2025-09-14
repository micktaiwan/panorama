## Feature: Project Links (Shortcuts)

### Goal

- Provide per‑project quick links (shortcuts to external URLs) visible near the project name/description, and a dedicated Links page listing all links across projects.
- Clicking a link opens the URL in a new tab (target=_blank) and increments a click counter displayed in the UI.

### Scope (MVP)

- [x] New Mongo collection: `Links` with full CRUD via Meteor methods and publications.
- [x] Project page: show/edit the project’s links near the header. Provide add, edit, delete, and click.
- [x] New page and route: `#/links` showing all links (optionally grouped/filtered by project).
- [x] Footer: add “Links” entry that navigates to the new page.
- [x] Reusable `Link` UI component used both in Project page and Links page.

### Implementation progress (extra items)

- [x] Inline editing on `LinkItem` for `name` and `url` (Enter validates)
- [x] Buttons “Add Link” create a default link and auto‑open inline edit with the name pre‑selected
- [x] URL normalization on insert/update (auto‑prepend `https://` when scheme is missing)
- [x] Links included in export (NDJSON archive)
- [x] Links indexed and searchable (kind `link`; content = `name + url`)
- [x] Links page shows the project name (or “not linked to a project”)

### Data model

- Collection: `Links`
  - Fields
    - `projectId: string` (required) — project this link belongs to
    - `name: string` (required) — label shown in the UI
    - `url: string` (required) — destination URL
    - `clicksCount: number` (default 0) — total number of clicks
    - `lastClickedAt: Date | null` — timestamp of last click
    - `createdAt: Date`, `updatedAt: Date`

### API structure (server)

- Files under `imports/api/links/` per project conventions:
  - `collections.js` — `export const LinksCollection = new Mongo.Collection('links')`
  - `methods.js` — async methods, input validation, string normalization
    - `links.insert({ projectId, name, url })` → returns `_id`
    - `links.update(linkId, modifier)` → partial updates (name, url, projectId)
    - `links.remove(linkId)`
    - `links.registerClick(linkId)` → increments `clicksCount`, sets `lastClickedAt`
  - `publications.js` — publish all (MVP local) and by project
    - `Meteor.publish('links', () => LinksCollection.find({}))`
    - `Meteor.publish('links.byProject', (projectId) => LinksCollection.find({ projectId }))`

Implementation notes (conform to @02-tech-notes.md):

- Use async collection API (`insertAsync`, `updateAsync`, etc.).
- Normalize/trim `name` and `url` on the server (string normalization rules).
- Avoid try/catch unless necessary; when used, log or rethrow explicit errors.
- Do not rely on `this.userId` (MVP is local single‑user).

Optional (later):

- Add Links to vector search index if helpful. For MVP we skip embeddings.

### Routing

- New route name: `links`
  - Path: `#/links`
  - Page component: `imports/ui/Links/LinksPage.jsx`
  - Footer navigation: add `Links` entry that calls `navigateTo({ name: 'links' })`.

### UI Components and styles

- Reusable `Link` component
  - Path: `imports/ui/components/Link/Link.jsx` + `Link.css`
  - Responsibilities:
    - Render a single link pill with clickable `name` (opens in new tab)
    - Register the click via `Meteor.call('links.registerClick', linkId)` without blocking navigation (fire‑and‑forget)
    - Offer an Edit button to switch to inline editing (name/url), and a Delete button with confirmation
  - Props: `{ link, startEditing? }`
  - Styling: co‑located in `Link.css`; no inline styles.

- Project page integration
  - Location: near the project header (below name/description block)
  - Component: `imports/ui/ProjectDetails/ProjectDetails.jsx` loads project links and renders a horizontal list of `Link` components
  - CRUD UX (inline editing rules):
    - Add: a compact “Add Link” primary button opens an inline row with two fields (name, url)
    - Edit: clickable name/url use `InlineEditable` with Enter to validate
    - Delete: trash icon per link (confirm via `Modal` only if needed)

- Links page
  - Path: `imports/ui/Links/LinksPage.jsx` + `LinksPage.css`
  - Shows all links (default sort by project then name). Provide optional filter by project.
  - Each row reuses the `Link` component and shows the project label (and a quick open to the project).

### UX and behavior

- Clicking a link:
  - Immediately opens the URL in a new tab using a normal `<a>` with `target=_blank` and `rel="noopener noreferrer"`.
  - Also triggers `Meteor.call('links.registerClick', id)` in a non‑blocking way (e.g., in a microtask or `setTimeout(0)`).
  - The UI updates reactively to reflect the new `clicksCount`.

- Error handling:
  - Avoid blocking navigation for click tracking. Log non‑fatal errors in the console.

### Publications and subscriptions

- Project page subscribes to `links.byProject(projectId)`.
- Links page subscribes to `links`.

### Accessibility

- Links are standard anchors with keyboard support.
- Buttons (add/edit/delete) use proper roles and focus states.

### Styling guidelines

- Co‑locate styles with components (`Link.css`, `LinksPage.css`).
- No inline styles; use existing tokens from `client/main.css`.
- Keep pills visually consistent with other action chips; show click count as a small badge.

### Footer

- Add `Links` to the footer next to other entries; clicking navigates to `#/links`.

### Testing checklist (MVP)

- Insert/update/remove link works and updates UI reactively.
- Click tracking increments the counter and updates `lastClickedAt`.
- Project page: links are visible under the header; creation and edits follow inline editing rules.
- Links page: lists all links and opens target URLs in new tabs.
- Footer navigation to `#/links` works.

### Future enhancements

- Group links by type (Docs, Dashboards, GitHub, Notion, etc.).
- Per-link tags:
  - Add `tags: string[]` on `Links` and render tag chips.
  - Filter/search links by tag on Links page; optional tag filter on Project page.
- Project‑level presets/templates for common links.
- Optional search integration (index `name + url`).
