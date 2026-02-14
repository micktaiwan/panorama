# Roadmap

Vue consolidee de l'etat de toutes les features et initiatives du projet.
Derniere mise a jour : 2026-02-14.

Legende : DONE = livre, MVP DONE = MVP en prod mais phases futures restantes, PLANNED = pas commence.

---

## Features

### DONE

| Feature | Doc | Notes |
|---------|-----|-------|
| User Log / Journal | [11-feat-userlog](features/11-feat-userlog.md) | Complet |
| Error Logging | [20-feature-error-logging](features/20-feature-error-logging.md) | Backend complet (capture console, cleanup). Pas d'UI dediee. |
| Claude Code Integration | [23-feature-claude-code](features/23-feature-claude-code.md) | Complet |
| Situation Analyzer | [17-feature-situation-analyser](features/17-feature-situation-analyser.md) | Tous les items de la roadmap coches |
| Automatic Reporting | [16-feature-automatic-reporting](features/16-feature-automatic-reporting.md) | MVP complet (voir "futures extensions" ci-dessous) |

### DONE mais desactive

| Feature | Doc | Notes |
|---------|-----|-------|
| Urgent Tasks Cron | [21-feature-urgent-tasks-cron](features/21-feature-urgent-tasks-cron.md) | Code complet mais **cron jobs commentes** dans `cron/jobs.js`. Methode de test manuelle dispo. |

### MVP DONE — phases futures restantes

#### Text to Tasks (10)
Doc : [10-feature-text2task](features/10-feature-text2task.md)
MVP livre. Reste :
- [ ] Drop past deadlines server-side
- [ ] Tests (prompt building, response parsing)
- [ ] E2E : save with inline-created project and deadline conversion
- [ ] Optional : notes editables avant save
- [ ] Optional : cacher les projets generiques du prompt

#### Alarms (12)
Doc : [12-feature-alarms](features/12-feature-alarms.md)
MVP livre. Reste :
- [ ] Tests unitaires (`computeNextOccurrence`, catch-up)
- [ ] Phase 2 — Recurrence : presets daily/weekly/monthly, `computeNextOccurrence`, UI jours de semaine, gestion DST
- [ ] Phase 3 — Polish : couleur/emoji par alarme, snooze custom, tri/filtrage, guard anti-double entre tabs

#### Search (13)
Doc : [13-feat-search](features/13-feat-search.md)
Recherche semantique Qdrant en prod. Roadmap hybrid non commencee :
- [ ] Phase 1 — BM25 lexical + RRF fusion (MongoDB text index ou MiniSearch)
- [ ] Phase 2 — Tuning par kind, filtres sessionId/kind, telemetrie
- [ ] Phase 3 — Engine upgrade optionnel (Meilisearch/Typesense, synonymes, stemming)

#### Links (14)
Doc : [14-feat-links](features/14-feat-links.md)
MVP complet (CRUD, inline edit, click tracking, export, search). Reste :
- [ ] Grouper par type (Docs, Dashboards, GitHub, Notion...)
- [ ] Tags par lien + filtre/recherche par tag
- [ ] Templates de liens par projet

#### Budget (15)
Doc : [15-feature-budget](features/15-feature-budget.md)
MVP complet (import Pennylane, vues report/vendors/monthly/check, dept/team classification). Reste :
- [ ] Integration API Pennylane (sync automatique)
- [ ] Moteur de regles pour l'assignation projet
- [ ] Budget planning vs actuals + alertes seuils
- [ ] Multi-currency + FX
- [ ] Attachement de justificatifs

#### Chat / AI Agent (18)
Doc : [18-feature-chat](features/18-feature-chat.md)
Chat global livre avec agent tool-loop (working memory, variable binding, cap 5 steps). Reste :
- [ ] Phase 4 — Mutation flow : confirmation gate, `confirmed` arg
- [ ] Phase 5 — Tool contracts : enveloppe standard `{ data, warning?, error? }`, validators
- [ ] Phase 6 — Observability : structured logs, metrics, weekly report
- [ ] Phase 7 — Tests : mapping generique, stopWhen, re-plan, integration chain, property tests
- [ ] Non-planner : contexte UI, CTAs par item, locale FR/EN, parallelize fetchPreview, deduplicate citations
- [ ] Mutations priorite 2 : tasks (create/update/status/deadline/tags), notes, links, alarms

#### Agent Switcher (24)
Doc : [24-feature-agent-switcher](features/24-feature-agent-switcher.md)
Phases 1-4 livrees (backend, switcher UI, controles model/effort, contexte conversationnel Codex). Phase 5 partielle :
- [ ] Afficher le modele utilise sur chaque reponse
- [ ] Persister preferences model/effort au niveau projet
- [ ] Changement de modele Claude : appliquer a la prochaine session
- [ ] Gerer le cas "codex CLI non installe"
- [ ] Test flow complet Claude -> Codex -> Claude avec contexte

### MVP DONE — a confirmer/tester

#### Slack Save to Panorama (24)
Doc : [24-feature-slack-save](features/24-feature-slack-save.md)
Integration Slack pour sauvegarder un message en note Panorama.
MVP implemente : `server/slack/bot.js`, `slackHelpers.js`, `@slack/bolt` installe, init conditionnelle dans `server/main.js`. Message shortcut, recherche semantique, modale, creation note, indexation Qdrant.
- [x] MVP : Slack App, Bolt Socket Mode, shortcut handler, modale, creation note brute
- [ ] Phase 2 : enrichissement LLM (titre, resume, next steps)
- [ ] Phase 3 : threads entiers, resolution noms, attachments, deduplication, badge Slack

#### Electron Desktop App (04)
Doc : [04-electron](04-electron.md)
Wrapper Electron pour distribuer Panorama en app desktop.
Dev mode implemente : `electron/main.js` (17KB), `preload.js`, scripts npm `dev:electron`, dep `electron@^38`. Window management, notifications, global shortcuts, IPC handlers.
- [x] Etape 1 : electron/ folder (main.js, preload.js)
- [x] Etape 2 : integration dev (Meteor + Electron)
- [ ] Etape 3 : integration prod (mongod embarque, bundle Node)
- [ ] Etape 4 : ajustements UI (IPC openFile, revealInFinder)
- [ ] Etape 5 : packaging et distribution (signing, auto-update)

### PLANNED — pas commence

#### Budget Salaries (19)
Doc : [19-feature-budget-salaries](features/19-feature-budget-salaries.md)
Tracking masse salariale : SalaryEvents, proration, charges employeur, vue Payroll.
- [ ] MVP : champs comp sur People, collection SalaryEvents, vue Budget Payroll
- [ ] Future : allocations par projet, scenario planning, multi-currency, export CSV

---

## Architecture et migrations

### Clean Architecture — adoption selective
Doc : [clean_archi_migration_plan](clean_archi_migration_plan.md)
Adoption de 4 patterns (repository, domain, conf, error codes) sans migration TypeScript.
- [ ] Phase 1 — Pilot : module `tasks` (repository.js, domain/, conf, codes/logs)
- [ ] Phase 2 — Expand : `projects`, `notes`, `noteSessions`, `budget`, `calendar`
- [ ] Phase 3 — Complete : 37 modules restants (incrementalement)

### Code Mode — spike hybride MCP + code runner
Doc : [code-mode](code-mode.md)
Analyse conclut : garder MCP pour les ops atomiques, introduire un code runner pour la composition multi-source.
- [ ] Phase 0 — Mesurer les workflows actuels (token usage, patterns multi-source)
- [ ] Phase 1 — Batch tools (tool_batchOperation, tool_projectDashboard)
- [ ] Phase 2 — Spike code mode (SDK manuel, runner Node VM, 2 test cases)
- [ ] Phase 3 — Decision data-driven

---

## Core — items orphelins

Ces items ne sont rattaches a aucun doc de feature :

- [ ] Compute project progress from tasks (aggregation logic)
- [ ] Risk and priority fields (simple enums) visible in list/detail
- [ ] Auto-update project.status (derived rules : blocked, active, planned, done)
- [ ] Fetch team users from lemlist API (read-only import)
- [ ] Daily recap job (cron) to compute and persist recaps

---

## Futures extensions (sur features livrees)

Extraites des docs de features done/MVP-done, a traiter si besoin :

- **Reporting (16)** : plus de types d'events, filtres par projet, export CSV, generation scheduled + email
- **Chat (18)** : support providers additionnels (Anthropic, Cohere), streaming, fine-tuning, multi-modal
- **Links (14)** : tags, groupes par type, templates
- **Budget (15)** : API Pennylane, regles d'assignation, alertes, FX, justificatifs
- **Budget Salaries (19)** : allocations projet, scenarios, FX, export

---

## Technical checklist

- [ ] Respect error-handling rule : avoid try/catch unless necessary; never silent-catch
- [ ] Keep secrets out of code
- [ ] Keep lines reasonably wrapped and headings spaced in docs
