## 2026-02-11

### Feature: Favicon losange/boussole
- Nouveau favicon SVG (losange indigo avec boussole stylisée, dégradé `--primary`)
- Référencé dans `client/main.html` via `<link rel="icon">`
- Icône affichée à côté du titre "Panorama" dans le header (`App.jsx`)
- PR: https://github.com/micktaiwan/panorama/pull/2

### Feature: Lien bidirectionnel projets Claude ↔ projets Panorama
- Champ optionnel `linkedProjectId` sur `claudeProjects` pour pointer vers un projet Panorama
- Sidebar Claude : affiche le nom du projet Panorama lié (cliquable), select pour changer/dissocier
- Formulaire de création Claude : dropdown pour associer un projet Panorama dès la création
- Page projet Panorama : lien "Claude Code: <nom>" dans les métadonnées si un projet Claude est lié
- Fichiers : `methods.js`, `ProjectList.jsx/.css`, `projectDetails.jsx`, `ProjectDetails.css`

### Feature: Import et gestion des commandes projet Claude
- "Import from disk" importe aussi les commandes depuis `<cwd>/.claude/commands/` de chaque projet Claude
- Affichage du nom du projet associé (au lieu de "project") dans Préférences → Commands
- Suppression automatique des commandes projet quand on supprime un projet Claude

### Fix: Claude Code "Loading sessions..." stuck indefinitely
- Used `useSubscribe` return value to detect subscription readiness in `ClaudeCodePage.jsx`
- Shows "No sessions yet." + "New Session" button when subscriptions are ready but no sessions exist

### Feature: Confirmation modal for Claude project deletion
- Added Modal confirmation before deleting a Claude project in `ProjectList.jsx`
- Prevents accidental project deletion

### Feature: Shift+click bypasses delete confirmation globally
- Shift+click on any delete button skips the confirmation modal and deletes immediately
- Applied to: Claude projects, Claude notes, Notes tabs, Notion integrations

### Feature: `/bypass` command
- New slash command that sets permissions to `Bash(*)`, `Edit`, `Write` for unrestricted access
