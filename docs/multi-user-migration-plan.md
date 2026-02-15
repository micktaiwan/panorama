# Plan de migration multi-user

Derniere mise a jour : 2026-02-15. Decisions prises le 2026-02-14.

## Contexte

### Pourquoi cette migration

Panorama est un projet personnel de Mick, construit en local depuis 8 mois. Au fil du temps, beaucoup de features tres personnelles ont ete ajoutees (situations analyzer, budget Pennylane, integration Gmail/Notion, Claude Code, etc.). Aujourd'hui, David (frere de Mick, contributeur au projet) et potentiellement d'autres personnes (Andrea, clients) veulent pouvoir utiliser Panorama depuis un navigateur ou un telephone.

L'objectif n'est pas de tout mettre en ligne. Seul le coeur metier (projets, taches, notes, liens, fichiers) sera accessible en remote. Toutes les features personnelles restent en local — il faudra lancer Panorama en local pour y acceder. Les collections migrent en remote au cas par cas, uniquement quand un vrai besoin le justifie.

### Parties prenantes

- **Mick** (micktaiwan) — auteur du projet, CTO lempire. Decide de l'architecture et des priorites. Utilise Panorama en local avec toutes les features.
- **David** (ddaydd) — frere de Mick, contributeur. Utilisera la version en ligne avec le coeur metier.
- **Autres utilisateurs** (Andrea, etc.) — acces en ligne au coeur metier uniquement.

### Etat des lieux (fevrier 2026)

L'application est **integralement single-user** :

- **0 package d'authentification** installe (pas de `accounts-base`, `accounts-password`, ni OAuth)
- **0 champ `userId`** sur les 34 collections (exception : `alarms` a un champ `userId` toujours `null`)
- **0 filtre par utilisateur** dans les publications — toutes retournent `Collection.find()` sans filtre
- **0 verification d'identite** dans les methodes — aucune methode ne check `this.userId`
- **1 document global `appPreferences`** pour toute l'app (champs : `filesDir`, `openaiApiKey`, `qdrantUrl`, `theme`, `ai: { mode, embeddingModel, chatModel, ... }`)
- **1 collection Qdrant globale** (`panorama` ou `panorama_<model>`) sans userId dans les payloads
- **Fichiers** servis via route HTTP `/files/` sans aucun controle d'acces
- **Export NDJSON** existant (21 collections), mais **aucune methode d'import** dans le code
- **Route `/tasks-mobile`** existante dans `imports/api/export/server.js` : page HTML server-rendered des tasks ouvertes, activable via flag — precedent d'acces distant

### Fichiers cles du codebase

| Quoi | Chemin |
|---|---|
| Collections | `imports/api/*/collections.js` |
| Methodes (CRUD) | `imports/api/*/methods.js` |
| Publications | `imports/api/*/publications.js` |
| Export petit (JSON) | `imports/api/export/methods.js` → `app.exportAll` |
| Export gros (NDJSON gzip, 21 collections) | `imports/api/export/server.js` → `app.exportArchiveStart` |
| Route `/tasks-mobile` | `imports/api/export/server.js` |
| Config / preferences | `imports/api/appPreferences/` et `imports/api/_shared/config.js` |
| Vector store (Qdrant) | `imports/api/search/vectorStore.js` |
| Route fichiers (upload) | `imports/api/files/methods.js` |
| Route fichiers (download HTTP) | `imports/api/files/methods.js` (WebApp.connectHandlers, sans auth) |
| LLM proxy | `imports/api/_shared/llmProxy.js` |
| Point d'entree serveur | `server/main.js` |
| Point d'entree client | `client/main.jsx` |

### Infrastructure existante sur le VPS (fevrier 2026)

Le VPS OVH (`51.210.150.25`) heberge deja le projet **Organizer** et une version de Panorama faite par David (Express 5 + React, a remplacer).

**Specs VPS** :

| Ressource | Valeur |
|---|---|
| RAM | 4 GB (upgrade fevrier 2026, etait 1.9 GB) + swap 2 GB |
| CPU | 2 vCPU (upgrade fevrier 2026, etait 1) |
| Disque | 40 GB (upgrade fevrier 2026, etait 20 GB). Swap: 2 GB (`/swapfile`) |

**Services Docker en place** :

| Container | Image | RAM | Role |
|---|---|---|---|
| `organizer-mongodb` | mongo:5 | ~170 MB | DB partagee (databases `organizer` + `panoramix`). Alias reseau : `mongodb` |
| `organizer-api` | Node.js 20 | ~97 MB | API Organizer (port 3001) |
| `organizer-qdrant` | qdrant:v1.16.3 | ~30 MB | Vector DB partagee (ports 6333/6334) |
| `organizer-coturn` | coturn | ~6 MB | TURN server (Organizer) |
| `mup-nginx-proxy` | zodern/nginx-proxy | ~58 MB | Reverse proxy SSL (ports 80/443) |
| `mup-nginx-proxy-letsencrypt` | letsencrypt-companion | ~20 MB | Renouvellement auto SSL |
| `panoramix-api` | Node.js Express 5 | ~61 MB | API Panorama de David (**a remplacer**) |
| `panoramix-web` | nginx:alpine | ~3 MB | Frontend React de David (**a remplacer**) |

**Domaine** : `panorama.mickaelfm.me` deja configure avec SSL Let's Encrypt via le proxy MUP.

**Reseau Docker** : `server_organizer-network` — tous les containers partagent ce reseau interne.

**Backups** : `mongodump` quotidien automatise pour la DB `organizer` (cron 2h UTC, 7j retention, `/opt/backups/`). La DB `panoramix` a des backups manuels dans `/opt/backups/panorama/` (pas automatises).

**Historique** : David avait d'abord deploye Panorama avec MUP (image `zodern/meteor:root`), puis l'a reecrit en Express 5 + React. Le proxy MUP est reste en place et gere le SSL pour `panorama.mickaelfm.me`.

### Contraintes

- **Claude Code reste local** : il necessite un shell local, donc l'instance Meteor de Mick continue de tourner sur son Mac
- **L'instance locale de Mick tape sur la DB remote** : les donnees partagees vivent sur le VPS, pas dans `.meteor/local/db`
- **Chaque user ne voit que ses donnees** : pas de projets partages pour l'instant (prevu plus tard)
- **Fichiers sur le disque du VPS** : pas de S3, le VPS OVH sert de stockage
- **Qdrant sur le VPS** : deja en place, recherche semantique accessible depuis tous les clients
- **App Android** : prevue plus tard, pas couverte par ce plan
- **RAM** : 4 GB (upgrade fevrier 2026), confortable pour Meteor + services existants

### Architecture cible

```
+------------------------+         +------------------------+
|   Panorama LOCAL       |         |   Panorama REMOTE      |
|   (Mac de Mick)        |         |   (VPS OVH)            |
|                        |         |                        |
|   Claude Code          |         |   App web              |
|   Fichiers locaux      |         |   (Mick, David, etc.)  |
|   MCP servers          |         |                        |
|   Electron             |         |   App Android (futur)  |
|                        |         |                        |
+----------+-------------+         +----------+-------------+
           |                                  |
      collections                        collections
       partagees                          partagees
           |                                  |
           +----------------+-----------------+
                            |
                   +--------+--------+
                   | MongoDB remote  |
                   | (VPS OVH)       |
                   +-----------------+
                   | Qdrant          |
                   | (VPS OVH)       |
                   +-----------------+
                   | Fichiers        |
                   | (disque VPS)    |
                   +-----------------+

+----------+-------------+
|   DB locale             |
|   (.meteor/local/db)    |
|                         |
|   claudeSessions        |
|   claudeMessages        |
|   claudeCommands        |
|   claudeProjects        |
|   mcpServers            |
|   toolCallLogs          |
|   errors (local debug)  |
+-------------------------+
```

## Split des collections : remote vs local

### Principe directeur

Panorama a ete concu comme un projet personnel avec beaucoup de features specifiques a Mick (situations analyzer, budget, gmail, notion, claude code, etc.). Pour le deploiement en ligne, seul le **coeur metier** est expose : gestion de projets, taches, notes et liens. Les autres features restent locales et migrent en remote uniquement quand un vrai use case le justifie.

Question cle : "Si David ou son client Andrea utilise l'app en ligne, qu'est-ce qu'ils utilisent ?" → projets, taches, notes, liens. C'est tout pour le MVP.

### Collections REMOTE (coeur metier, sur le VPS)

| Collection | userId requis | Notes |
|---|---|---|
| `projects` | oui | Chaque user voit ses projets |
| `tasks` | oui | Via `projectId` → projet du user |
| `notes` | oui | |
| `noteSessions` | oui | |
| `noteLines` | oui (denormalise) | userId copie depuis la session |
| `links` | oui | |
| `files` | oui | Metadata. Fichiers physiques sur disque VPS |
| `userPreferences` | oui (nouvelle) | Theme, cle API, config AI — par user |
| `users` | oui (auto Meteor) | Creee automatiquement par `accounts-base`. Contient emails, hashed passwords, login tokens |
| `meteor_accounts_loginServiceConfiguration` | — | Creee automatiquement par `accounts-base`. Config OAuth (si utilise plus tard) |

### Collections LOCAL ONLY (restent dans .meteor/local/db)

Features personnelles de Mick ou specifiques a l'instance locale.

| Collection | Raison |
|---|---|
| `people` | Annuaire personnel |
| `teams` | Gestion d'equipe personnelle |
| `alarms` | Alarmes locales (BroadcastChannel, setTimeout) |
| `situations` | Feature perso (analyzer) |
| `situation_actors` | |
| `situation_notes` | |
| `situation_questions` | |
| `situation_summaries` | |
| `budgetLines` | Feature perso (imports Pennylane) |
| `vendorsCache` | |
| `vendorsIgnore` | |
| `calendarEvents` | Feature perso |
| `chats` | Historique chat AI |
| `userLogs` | Journal personnel |
| `gmailMessages` | Feature perso (integration Gmail) |
| `gmailTokens` | Tokens OAuth sensibles |
| `emailActionLogs` | Logs d'actions email |
| `notionIntegrations` | Feature perso (integration Notion) |
| `notionTickets` | |
| `claudeSessions` | Claude Code = shell local |
| `claudeMessages` | |
| `claudeCommands` | |
| `claudeProjects` | |
| `mcpServers` | Config MCP locale |
| `toolCallLogs` | Debug local |
| `errors` | Debug local |
| `appPreferences` | Config d'instance (filesDir, qdrantUrl) |

### Migration progressive

Les collections locales peuvent migrer en remote au cas par cas quand le besoin se presente (ex: David veut les alarmes, un client veut voir les fichiers). Le fait d'avoir userId sur les collections remote des le depart rend cette evolution simple.

---

## Phases de migration

### Phase 1 — Authentification ✅ DONE (2026-02-15)

**Objectif** : systeme de login fonctionnel, prerequis pour tout le reste.

**Statut** : implemente et teste en local. Branche `feature/multi-user-auth`.

#### Ce qui a ete fait

- **Packages installes** : `accounts-base`, `accounts-password`, `ddp-rate-limiter`
- **Config serveur** (`server/accounts.js`) : `Accounts.config({ passwordMinLength: 8 })`, `Accounts.validateNewUser()`, email templates (verification + reset password avec URLs hash-based), rate limiting (createUser 5/10s, login 10/10s, forgotPassword 3/60s)
- **Import** dans `server/main.js`
- **Composant AuthGate** (`imports/ui/Auth/AuthGate.jsx`) : wrappe `<App/>`, redirige vers la page login si pas authentifie
- **Pages auth** dans `imports/ui/Auth/` : `Login.jsx`, `Signup.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, `VerifyEmail.jsx` + CSS partage dans `AuthGate.css`
- **Routes** ajoutees dans `imports/ui/router.js` : `#/login`, `#/signup`, `#/forgot-password`, `#/reset-password/:token`, `#/verify-email/:token`
- **Logout** : bouton dans le header de `App.jsx` (email du user + bouton logout)
- **Auth partout** : pas de bypass en local, Mick s'authentifie comme tout le monde

#### Ce qui reste a faire (non-bloquant pour la suite)

- **Configurer `EMAIL_URL`** (Resend SMTP) pour l'envoi reel d'emails — sans ca, les emails sont imprimes dans la console serveur Meteor (suffisant pour le dev)
- **Configurer DNS SPF/DKIM** sur le domaine d'expedition dans Resend
- **Verification email non bloquante** : le signup ne bloque pas le login si l'email n'est pas verifie. Peut etre durci plus tard avec `Accounts.validateLoginAttempt()`
- Optionnel : `accounts-google` pour OAuth (plus tard)
- Optionnel : role admin pour Mick (gestion des users, si besoin plus tard)

---

### Phase 2 — Multi-tenancy (userId partout) ✅ DONE (2026-02-15)

**Objectif** : chaque document appartient a un user. C'est le plus gros chantier.

**Statut** : implemente et teste en local. Branche `feature/multi-user-auth`.

#### Ce qui a ete fait

**Etape 1 — Module auth helper** (`imports/api/_shared/auth.js`) :
- `ensureLoggedIn(userId)` — throw `not-authorized` si falsy
- `ensureOwner(collection, docId, userId)` — find `{_id, userId}`, throw `not-found` si absent, retourne le doc
- `isRemoteInstance()` — `process.env.PANORAMA_MODE === 'remote'`
- `ensureLocalOnly()` — throw `local-only` si `isRemoteInstance()`

**Etape 2 — userId sur les 8 collections remote** :

Pattern applique a `projects`, `tasks`, `notes`, `noteSessions`, `noteLines`, `links`, `files` :
- **Insert** : `ensureLoggedIn(this.userId)` + `userId: this.userId` dans le doc
- **Update/Remove** : `ensureLoggedIn(this.userId)` + `ensureOwner(Collection, docId, this.userId)`
- **Publications** : `if (!this.userId) return this.ready()` + `find({ userId: this.userId })`
- **aiMethods** : meme pattern pour `projects/aiMethods.js`, `tasks/aiMethods.js`, `notes/aiMethods.js`, `sessions/aiMethods.js`

Fichiers modifies : `*/methods.js`, `*/publications.js`, `*/aiMethods.js` pour les 7 collections + `userPreferences`.

Points d'attention traites :
- `tasks.promoteToTop` : le `globalOpenSelector` filtre par userId (sinon re-rank des taches des autres users)
- `notes.duplicate` : le doc copie a `userId: this.userId`
- `noteSessions.remove` : cascade delete de noteLines filtre par userId
- `noteLines` : userId denormalise (pas de jointure vers session)
- `links.registerClick`, `links.getUrl` : ownership check
- `projects.remove` : cascade delete de tasks/notes/sessions/lines/links/files filtre par userId

**Etape 3 — Export securise** :
- `app.exportAll` : `ensureLoggedIn` + chaque `find` filtre par `{userId: this.userId}`
- `app.exportArchiveStart` : `ensureLoggedIn`, userId passe au job, `writeCollectionNdjson` filtre les collections remote par userId

**Etape 4 — Guards local-only** :
- `ensureLocalOnly()` ajoute en tete de **chaque methode** des ~21 fichiers methods.js des collections locales : situations, situationActors, situationNotes, situationQuestions, situationSummaries, budget, calendar, chats, userLogs (+aiMethods), emails, notionIntegrations, notionTickets, claudeSessions, claudeCommands, claudeProjects, mcpServers, errors, alarms, people, teams
- Approche choisie : **guard par methode** (plus simple que l'import conditionnel)
- ~146 guards au total

**Etape 5 — Collection `userPreferences`** :
- Fichiers crees : `imports/api/userPreferences/collections.js`, `methods.js`, `publications.js`
- Methodes : `userPreferences.ensure` (upsert initial), `userPreferences.update` (mise a jour partielle)
- Publication filtree par `this.userId`, index unique `{ userId: 1 }`

Split des preferences :
- **`userPreferences`** (per-user, remote) : `theme`, `openaiApiKey`, `anthropicApiKey`, `perplexityApiKey`, `ai` (mode, fallback, models, timeouts)
- **`appPreferences`** (instance, local) : `filesDir`, `qdrantUrl`, `devUrlMode`, `onboardedAt`, `pennylaneBaseUrl`, `pennylaneToken`, `slack`, `googleCalendar`, `calendarIcsUrl`, `cta`, `localUserId`

Refactoring `config.js` :
- Nouveaux getters async user-aware : `getUserPrefs(userId)`, `getOpenAiApiKeyAsync(userId)`, `getAnthropicApiKeyAsync(userId)`, `getAIConfigAsync(userId)`
- `getLocalUserId()` : lit `localUserId` depuis appPreferences (pour le contexte MCP)
- Les getters sync existants (`getOpenAiApiKey()`, `getAIConfig()`) continuent de fonctionner (backward compat pour code serveur hors methode)

UI refactoring :
- `Preferences.jsx` : subscribe a `userPreferences`, passe `userPref` prop aux sous-composants
- `PrefsGeneral.jsx` : theme lit/ecrit dans userPreferences
- `PrefsSecrets.jsx` : API keys (openai, anthropic, perplexity) lisent/ecrivent dans userPreferences
- `PrefsAI.jsx` : config AI lit/ecrit dans userPreferences via `userPreferences.update`
- `App.jsx` : theme sync lit depuis userPreferences

**Etape 6 — Indexes MongoDB** :

Ajoutes dans `Meteor.startup` de `server/main.js` :

| Collection | Index |
|---|---|
| `projects` | `{ userId: 1 }` |
| `tasks` | `{ userId: 1, projectId: 1 }` |
| `tasks` | `{ userId: 1, done: 1 }` |
| `notes` | `{ userId: 1, projectId: 1 }` |
| `noteSessions` | `{ userId: 1, projectId: 1 }` |
| `noteLines` | `{ userId: 1, sessionId: 1 }` |
| `links` | `{ userId: 1, projectId: 1 }` |
| `files` | `{ userId: 1, projectId: 1 }` |
| `userPreferences` | `{ userId: 1 }` unique |

**Etape 7 — MCP tools userId filtering** :

Le MCP server obtient le userId via `localUserId` dans `appPreferences` (lu par `getLocalUserId()` dans `config.js`).

Helpers ajoutes dans `handlers.js` :
- `getMCPUserId()` : lit `localUserId`, throw si non configure
- `callMethodAs(methodName, userId, ...args)` : appelle `Meteor.server.method_handlers[methodName].call({userId}, ...args)` pour simuler un appel DDP avec userId

Lectures modifiees (ajout de `{userId}` au selector) :
- `validateProjectId`, `fetchPreview`
- `tool_tasksByProject`, `tool_tasksFilter`, `tool_projectsList`, `tool_projectByName`
- `tool_notesByProject`, `tool_noteById`, `tool_notesByTitleOrContent`
- `tool_noteSessionsByProject`, `tool_noteLinesBySession`
- `tool_linksByProject`, `tool_filesByProject`
- `tool_collectionQuery` : injection automatique de userId si la collection est dans `REMOTE_COLLECTIONS`
- `tool_projectsOverview` : utilise `callMethodAs` au lieu de `Meteor.callAsync`

Ecritures modifiees (remplacement de `Meteor.callAsync` par `callMethodAs`) :
- `tool_createProject`, `tool_updateProject`
- `tool_createTask`, `tool_updateTask`, `tool_deleteTask`
- `tool_createNote`, `tool_updateNote`, `tool_deleteNote`
- `tool_createLink`

Les outils MCP local-only (alarms, emails, etc.) gardent `Meteor.callAsync` — `ensureLocalOnly()` ne verifie pas userId.

**Etape 8 — Methodes supplementaires securisees** :

Au-dela du plan initial, les methodes suivantes ont ete mises a jour avec `ensureLoggedIn` + userId filtering :
- `panorama.getOverview` : filtre projects/tasks/notes/links/files/sessions par userId
- `panorama.setRank` : `ensureLoggedIn` + `ensureOwner`
- `panorama.countAllTokens` : filtre les collections remote par userId
- `search.instant` : filtre projects/tasks/notes par userId
- `reporting.recentActivity` : filtre projects/tasks/notes par userId
- `reporting.aiSummarizeWindow` : filtre projects/tasks/notes par userId
- `chat.ask` : `ensureLocalOnly`

#### Limitation connue — Qdrant non isole par user

L'index Qdrant est **global** : les vecteurs ne contiennent pas de `userId` dans les payloads, et les fonctions `collectDocs()`/`collectDocsByKind()` (utilisees par `qdrant.indexAll`/`qdrant.indexStart`) requetent les collections remote sans filtre userId. La recherche semantique retourne potentiellement des resultats d'autres users.

**Impact** : acceptable tant que Qdrant tourne en local. En deploiement multi-user, il faut implementer la Phase 7 (Qdrant multi-user) — voir ci-dessous.

---

### Phase 3 — Dual MongoDB driver

**Objectif** : l'instance locale de Mick se connecte a la DB remote pour les collections partagees, et garde la DB locale pour le reste.

#### 3.1 Configurer le remote driver

```javascript
// imports/api/_shared/remoteDriver.js
import { MongoInternals } from 'meteor/mongo';

const remoteUrl = process.env.REMOTE_MONGO_URL;

export const remoteDriver = remoteUrl
  ? new MongoInternals.RemoteCollectionDriver(remoteUrl)
  : null; // Si pas de REMOTE_MONGO_URL, tout reste local (dev, tests)
```

#### 3.2 Modifier les declarations de collections

```javascript
// imports/api/projects/collections.js
import { Mongo } from 'meteor/mongo';
import { remoteDriver } from '/imports/api/_shared/remoteDriver';

const driverOptions = remoteDriver ? { _driver: remoteDriver } : {};

export const ProjectsCollection = new Mongo.Collection('projects', driverOptions);
```

Appliquer ce pattern a toutes les collections remote.

Les collections local-only ne changent pas (pas de `driverOptions`).

#### 3.3 Configuration par environnement

| Environnement | MONGO_URL | REMOTE_MONGO_URL |
|---|---|---|
| Local (Mick) | `mongodb://localhost:3001/meteor` (defaut Meteor) | `mongodb://localhost:27018/panorama` (via tunnel SSH vers `organizer-mongodb`) |
| Remote (VPS) | `mongodb://organizer-mongodb:27017/panorama` (reseau Docker) | non defini (tout est local au VPS) |
| Dev/Test | defaut Meteor | non defini (tout local) |

Quand `REMOTE_MONGO_URL` n'est pas defini, `remoteDriver` est `null` et toutes les collections utilisent la DB locale. Cela preserve la compatibilite dev/test.

#### 3.4 Tunnel SSH automatique

L'instance locale de Mick accede a MongoDB via tunnel SSH (MongoDB bind localhost sur le VPS, port jamais expose sur internet).

```bash
# Le tunnel forward le port local 27018 vers le MongoDB du VPS (localhost:27017)
autossh -M 0 -f -N -L 27018:localhost:27017 ubuntu@51.210.150.25
```

Integration dans le workflow de dev :
- Script `start-local.sh` qui demarre le tunnel puis lance Meteor
- Ou `autossh` en service launchd (macOS) pour un tunnel permanent
- Port local 27018 (pour ne pas conflicte avec un MongoDB local eventuel)

#### 3.5 Oplog tailing

Pour la reactivite Meteor sur la DB remote, configurer `REMOTE_MONGO_OPLOG_URL` (aussi via le tunnel SSH) :

```
REMOTE_MONGO_OPLOG_URL=mongodb://localhost:27018/local
```

Sans oplog, Meteor fait du polling (moins reactif mais fonctionnel).

**Prerequis** : MongoDB doit tourner en **replica set** pour que l'oplog existe. Actuellement `organizer-mongodb` n'est **pas** en replica set. Un replica set single-node suffit :

```bash
# Modifier le docker-compose d'organizer pour ajouter --replSet rs0 au lancement de MongoDB
# Puis initialiser une seule fois
docker exec organizer-mongodb mongosh --eval 'rs.initiate()'
```

**Attention** : ce changement impacte aussi Organizer. Verifier que l'API Organizer fonctionne correctement apres l'activation du replica set (normalement transparent pour Mongoose).

Sans replica set, l'oplog n'existe pas et Meteor tombe en fallback polling automatiquement.

---

### Phase 4 — Migration des donnees existantes

**Objectif** : transferer les 8 mois de donnees locales vers la DB remote.

#### 4.1 Construire la methode d'import

**Il n'existe aucune methode d'import dans le code actuel.** Seul l'export existe (`app.exportArchiveStart` dans `imports/api/export/server.js`, exporte 21 collections en NDJSON gzip). Il faut construire le pendant :

```javascript
// imports/api/export/methods.js
async 'app.importArchive'({ ndjsonContent, targetUserId }) {
  // Pour chaque ligne du NDJSON :
  // 1. Parser { collection, doc } ou { collection, type: 'begin'/'end' }
  // 2. Filtrer : ne migrer que les collections remote (projects, tasks, notes, noteSessions, noteLines, links, files)
  // 3. Ajouter userId: targetUserId au doc
  // 4. Inserer dans la collection correspondante (via le remote driver)
  // 5. Gerer les conflits d'_id (skip ou overwrite)
}
```

#### 4.2 Procedure de migration

1. Demarrer Panorama en local (mode classique, DB locale)
2. Exporter via `app.exportArchiveStart` → fichier `.ndjson.gz`
3. Demarrer la DB remote sur le VPS
4. Creer le user Mick dans la DB remote (via accounts-password)
5. Executer l'import avec `targetUserId` = id du user Mick
6. Verifier les donnees (compter les documents, spot-check)
7. Configurer `REMOTE_MONGO_URL` sur l'instance locale
8. Redemarrer l'instance locale → elle tape sur la DB remote
9. Verifier que tout fonctionne
10. Les donnees dans `.meteor/local/db` deviennent un backup

#### 4.3 Migration des fichiers

Les fichiers physiques sont dans `~/PanoramaFiles` (ou le chemin configure).

1. `rsync` ou `scp` du repertoire vers le VPS : `/var/www/panorama/files/`
2. Mettre a jour la collection `files` (metadata) pour pointer vers les nouveaux chemins
3. La route HTTP `/files/` du Meteor remote sert les fichiers depuis le disque VPS
4. L'instance locale de Mick garde ses fichiers locaux (pour Claude Code etc.)
5. Les nouveaux fichiers uploades via le web vont directement sur le disque VPS

#### 4.4 Backfill des champs denormalises

Apres l'import initial (4.2), certains documents ont besoin d'un backfill :

- **noteLines** : ajouter `userId` sur chaque noteLine (copie depuis la noteSession parente via `sessionId`)
- Verifier que tous les documents des 8 collections remote ont bien un champ `userId` non-null
- Script de verification :

```javascript
// Pour chaque collection remote, compter les documents sans userId
for (const coll of ['projects', 'tasks', 'notes', 'noteSessions', 'noteLines', 'links', 'files']) {
  const count = await db.collection(coll).countDocuments({ userId: { $exists: false } });
  console.log(`${coll}: ${count} documents sans userId`);
}
```

Ce backfill doit etre fait **avant** de basculer les publications en mode filtre userId (sinon les documents sans userId deviennent invisibles).

#### 4.5 Reindexation Qdrant

Qdrant est deja en place sur le VPS (`organizer-qdrant`, v1.16.3, ports 6333/6334).

1. ~~Installer Qdrant~~ → deja fait
2. Configurer `QDRANT_URL=http://organizer-qdrant:6333` sur l'instance remote (reseau Docker)
3. Reindexer tous les documents avec userId dans les payloads
4. L'instance locale de Mick pointe aussi vers le Qdrant du VPS via tunnel SSH (`QDRANT_URL=http://localhost:16333`)

---

### Phase 5 — Deploiement de l'instance remote

**Objectif** : Panorama accessible depuis un navigateur.

#### 5.1 Nom de domaine

**Resolu** : `panorama.mickaelfm.me` est deja configure avec SSL Let's Encrypt via le proxy MUP existant. Ce domaine sera reutilise pour le deploiement Meteor.

- `ROOT_URL=https://panorama.mickaelfm.me`
- SSL : deja gere par `mup-nginx-proxy` + `mup-nginx-proxy-letsencrypt`
- Resend : configurer SPF/DKIM sur `mickaelfm.me` (ou utiliser un autre domaine d'expedition)

#### 5.2 Infrastructure sur le VPS

L'infrastructure est deja en place (voir "Infrastructure existante" dans le contexte). Pas besoin d'installer :

- **MongoDB** : ~~container Docker dedie~~ → reutiliser `organizer-mongodb` (mongo:5) avec une database `panorama` separee. Alias reseau `mongodb` deja disponible
- **Qdrant** : ~~a installer~~ → `organizer-qdrant` (v1.16.3) deja en place, collections isolees par nom
- **Reverse proxy + SSL** : ~~a configurer~~ → `mup-nginx-proxy` + letsencrypt companion deja en place
- **Panorama Meteor** : seul composant a deployer — remplace les containers `panoramix-api` + `panoramix-web` de David

#### 5.3 Deploiement avec MUP (Meteor Up)

**Approche recommandee** : utiliser [MUP](https://meteor-up.com/) pour automatiser le deploiement. MUP gere le build, le deploiement Docker, Nginx reverse proxy et Let's Encrypt en une seule commande.

**Compatibilite Meteor 3** : MUP fonctionne avec Meteor 3 moyennant un workaround — le CLI MUP doit tourner sous Node 20.9.0 (bug SSH avec les versions plus recentes). Workaround : `nvm exec 20.9.0 mup deploy`. Le projet MUP est en cours de revitalisation (nouvelle organisation GitHub, nouveaux maintainers en janvier 2026).

**Note** : le proxy MUP (`mup-nginx-proxy` + letsencrypt) est deja en place sur le VPS et gere le domaine `panorama.mickaelfm.me`. Le deploiement MUP reutilisera ce proxy existant.

**Setup** :

```bash
npm install -g mup
mkdir .deploy && cd .deploy
mup init
```

**Configuration** (`mup.js`) :

```javascript
module.exports = {
  servers: {
    one: {
      host: '51.210.150.25',
      username: 'ubuntu',
      pem: '~/.ssh/id_rsa'
    }
  },
  app: {
    name: 'panorama',
    path: '../',
    docker: { image: 'zodern/meteor:root' },
    servers: { one: {} },
    buildOptions: { serverOnly: true },
    env: {
      ROOT_URL: 'https://panorama.mickaelfm.me',
      MONGO_URL: 'mongodb://organizer-mongodb:27017/panorama',  // DB partagee, database separee
      PORT: 4000,
      EMAIL_URL: 'smtp://resend:re_YOUR_API_KEY@smtp.resend.com:465',
      PANORAMA_MODE: 'remote',
    },
    deployCheckWaitTime: 60,
  },
  proxy: {
    domains: 'panorama.mickaelfm.me',
    ssl: { letsEncryptEmail: 'faivred@gmail.com', forceSSL: true }
  },
  // PAS de section mongo ici — on reutilise organizer-mongodb
};
```

**Deploiement** :

```bash
# Setup initial (une seule fois)
nvm exec 20.9.0 mup setup

# Deploy
nvm exec 20.9.0 mup deploy

# Logs
nvm exec 20.9.0 mup logs
```

**Ce que MUP gere** : build Meteor, container Docker app, Nginx reverse proxy, Let's Encrypt SSL, zero-downtime deploy, logs.

**Ce que MUP ne gere PAS** (deja en place ou a faire separement) :
- MongoDB : reutilise `organizer-mongodb` existant (database `panorama` separee)
- Qdrant : reutilise `organizer-qdrant` existant
- Backups : etendre le script existant (voir 5.7)

**Fallback** : si MUP pose trop de problemes avec Meteor 3, deploiement manuel via `meteor build` + `scp` + PM2 (voir 5.9).

#### 5.4 Flag isRemote

Variable d'environnement ou setting Meteor pour distinguer les deux instances :

```javascript
// Cote serveur
export const isRemoteInstance = () =>
  process.env.PANORAMA_MODE === 'remote' ||
  Meteor.settings?.public?.isRemote === true;

// Cote client (Meteor.settings.public est accessible)
export const isRemoteInstance = () =>
  Meteor.settings?.public?.isRemote === true;
```

Usage : masquer les features local-only dans l'UI remote. Sur l'instance remote, les users ne voient que le coeur metier (projets, taches, notes, liens, fichiers). Les features perso (Claude Code, MCP, situations, budget, calendrier, gmail, notion, alarms, chat AI, userLogs) sont masquees.

#### 5.5 Securite

- **HTTPS obligatoire** (Nginx + Let's Encrypt)
- **MongoDB** : ne pas exposer le port 27017 sur internet. Connexion locale uniquement (Meteor sur le meme VPS) + tunnel SSH pour l'instance locale de Mick
- **Rate limiting** : `ddp-rate-limiter` (package Meteor built-in) sur les methodes. Note : aucun rate limiting n'est installe actuellement — a ajouter des la Phase 1
- **Validation des inputs** : renforcer les `check()` existants (actuellement `check(doc, Object)` sans validation des champs individuels dans la plupart des methodes)
- **CORS** : configurer si l'app Android tape directement sur le DDP

#### 5.6 Securiser les routes HTTP existantes

Plusieurs routes HTTP server-side existent sans authentification :

| Route | Usage actuel | Action requise |
|---|---|---|
| `/files/<name>` | Sert les fichiers uploades | Ajouter auth (cookie session ou token). Detaille en Phase 6 |
| `/tasks-mobile` | Page HTML server-rendered des taches ouvertes | Ajouter auth (cookie session, basic auth, ou token dans l'URL) |
| `/download-export/<jobId>` | Telecharge l'export NDJSON | Ajouter auth + verifier que l'export appartient au user |
| `/oauth/google-calendar/callback` | Callback OAuth Google Calendar | Local-only, masquer sur l'instance remote (via `isRemoteInstance()`) |

#### 5.7 Monitoring et backups

Pas de monitoring ni de backup automatique actuellement. A mettre en place sur le VPS :

**Backups MongoDB** :
- Le script `/usr/local/bin/backup-organizer.sh` existe deja (cron quotidien 2h UTC, 7j retention, `mongodump --db organizer`)
- **A etendre** : ajouter `--db panorama` au script (ou creer un second cron `backup-panorama.sh`)
- Les backups Panorama manuels existants (`/opt/backups/panorama/`) seront remplaces par le cron automatise
- Tester la restauration avec `mongorestore` avant la mise en production

**Monitoring applicatif** :
- **PM2** ou **Docker healthchecks** pour le process Meteor (redemarrage auto si crash)
- **Uptime monitoring** : service externe (UptimeRobot, Healthchecks.io) qui ping l'URL publique
- **Logs** : `pm2 logs` ou Docker logging driver. Rotation des logs

**Alertes** :
- Alerte si le service tombe (via uptime monitor)
- Alerte si l'espace disque est bas (fichiers uploades + MongoDB)

MUP gere le redemarrage automatique du container Meteor (Docker restart policy). Pour le monitoring externe, UptimeRobot gratuit sur `https://panorama.mickaelfm.me` suffit pour le MVP.

#### 5.8 Sizing VPS et budget memoire

**Specs VPS** : 4 GB RAM, 2 vCPU, 40 GB disque. Upgrade de fevrier 2026 (etait 1.9 GB / 1 vCPU / 20 GB).

**Estimation memoire apres deploiement** :

| Container | RAM estimee | Notes |
|---|---|---|
| `organizer-mongodb` | ~170 MB | Existant. Database `panorama` ajoutera un peu |
| `organizer-api` | ~97 MB | Existant, inchange |
| `organizer-qdrant` | ~30 MB | Existant. Collections Panorama ajouteront un peu |
| `organizer-coturn` | ~6 MB | Existant, inchange |
| `mup-nginx-proxy` | ~58 MB | Existant, inchange |
| `mup-nginx-proxy-letsencrypt` | ~20 MB | Existant, inchange |
| **Panorama Meteor** | **~250-400 MB** | **Nouveau** — remplace panoramix-api (61 MB) + panoramix-web (3 MB) |
| **Total estime** | **~630-780 MB** | Reste ~3.2 GB pour l'OS et le cache — confortable |

Avec 4 GB de RAM, le budget memoire n'est plus une contrainte.

#### 5.9 Fallback : deploiement manuel (si MUP ne convient pas)

Si MUP pose des problemes de compatibilite avec Meteor 3, deploiement manuel :

```bash
# Sur le Mac
meteor build --server-only ../output
scp ../output/panorama.tar.gz ubuntu@51.210.150.25:/var/www/panorama/

# Sur le VPS (via SSH)
cd /var/www/panorama
tar xzf panorama.tar.gz
cd bundle/programs/server && npm install --production
pm2 restart panorama
```

Dans ce cas, Nginx + Let's Encrypt et PM2 doivent etre configures manuellement sur le VPS.

**CI/CD (plus tard)** : GitHub Actions qui build + deploy sur push vers `main`, a envisager quand les deploys deviennent frequents.

---

### Phase 6 — Stockage de fichiers distant

**Objectif** : les users du web peuvent uploader et voir des fichiers.

#### 6.1 Modifier la route d'upload

Actuellement les fichiers sont ecrits sur le filesystem local via `files.insert` (base64 → `fs.writeFile`).

Pour l'instance remote :
- Les fichiers sont ecrits sur le disque du VPS (`/var/www/panorama/files/` ou configurable)
- La route HTTP `/files/<storedFileName>` sert les fichiers avec verification d'authentification
- Ajouter un check : le fichier appartient-il a un projet du user connecte ?

Pour l'instance locale de Mick :
- Les fichiers locaux restent accessibles localement
- Les fichiers distants sont accessibles via l'URL du VPS

#### 6.2 Auth sur la route de fichiers

Actuellement la route `/files/` n'a aucun controle d'acces. Ajouter :
- Verifier le cookie de session Meteor (ou un token dans le query string)
- Verifier que le fichier appartient au user

---

### Phase 7 — Qdrant multi-user

**Objectif** : la recherche semantique fonctionne pour chaque user independamment.

**Statut** : non commence. Prerequis avant deploiement multi-user en production.

**Contexte** : apres la Phase 2, l'index Qdrant est le seul composant encore global. Les fonctions `collectDocs()` et `collectDocsByKind()` dans `search/methods.js` requetent les collections remote sans filtre userId. L'outil MCP `tool_semanticSearch` dans `handlers.js` interroge Qdrant sans filtre userId non plus. En consequence, la recherche semantique peut retourner des resultats appartenant a d'autres users.

#### 7.1 Ajouter userId aux payloads Qdrant

```javascript
// search/vectorStore.js - upsertDoc
export const upsertDoc = async ({ kind, id, text, projectId, sessionId, userId }) => {
  const payload = {
    kind,
    docId: `${kind}:${id}`,
    preview: makePreview(text),
    projectId,
    sessionId,
    userId,  // NOUVEAU
    indexedAt: new Date().toISOString()
  };
  // ...
};
```

#### 7.2 Filtrer les recherches par userId

```javascript
// search/vectorStore.js - searchDocs
export const searchDocs = async (queryText, userId, limit = 10) => {
  const vector = await embedText(queryText);
  const results = await client.search(COLLECTION(), {
    vector,
    limit,
    filter: {
      must: [{ key: 'userId', match: { value: userId } }]
    }
  });
  return results;
};
```

#### 7.3 Adapter les fonctions d'indexation

Les fonctions suivantes dans `search/methods.js` doivent etre modifiees pour filtrer par userId lors de la collecte des documents :
- `collectDocs()` : ajouter `{userId}` au selector des 6 collections remote (projects, tasks, notes, noteSessions, noteLines, links)
- `collectDocsByKind()` : idem
- `qdrant.indexStart` et `qdrant.indexKindStart` : passer userId au contexte d'indexation

#### 7.4 Adapter les outils MCP

- `tool_semanticSearch` dans `handlers.js` : ajouter un filtre Qdrant `{ must: [{ key: 'userId', match: { value: getMCPUserId() } }] }` dans la requete de recherche

#### 7.5 Reindexation

Apres la migration des donnees, reindexer tous les documents avec le userId dans les payloads. Utiliser le flow existant (Preferences → Qdrant → Rebuild) en l'adaptant pour inclure userId.

---

## Strategie de test

La migration touche transversalement toute l'application. Tests a prevoir :

### Tests unitaires

- **Helpers auth** (`ensureLoggedIn`, `ensureOwner`) : verifier les cas nominaux et les rejets
- **Config resolution** : verifier que `getConfig()` merge correctement userPreferences et appPreferences
- **Import NDJSON** : verifier le parsing, l'ajout de userId, le filtrage des collections

### Tests d'integration (multi-user)

- **Isolation des donnees** : creer deux users, verifier que user A ne voit pas les donnees de user B (publications, methodes, Qdrant)
- **Ownership check** : user A ne peut pas modifier/supprimer un document de user B
- **Publications filtrees** : verifier que chaque publication retourne uniquement les documents du user connecte
- **Routes HTTP** : verifier que `/files/`, `/download-export/`, `/tasks-mobile` rejettent les requetes non authentifiees

### Tests de non-regression

- **Export** : verifier que l'export NDJSON fonctionne toujours apres l'ajout de userId
- **Features locales** : verifier que les features local-only (Claude Code, situations, budget, etc.) fonctionnent toujours sans regression
- **MCP tools** : verifier que les outils MCP retournent uniquement les donnees du user local

### Approche

- Utiliser le test runner existant (`meteortesting:mocha`)
- Ecrire les tests au fil de l'eau (chaque phase produit ses tests)
- Les tests d'isolation multi-user sont les plus critiques — les ecrire en priorite des la Phase 2

---

## Plan de rollback

### Principe

Chaque phase doit etre reversible independamment. La DB locale (`.meteor/local/db`) sert de backup naturel tant que la migration n'est pas validee.

### Par phase

| Phase | Rollback |
|---|---|
| **Phase 1 (Auth)** | Retirer `accounts-base`/`accounts-password`, supprimer les composants Auth. Les collections Meteor `users` et `meteor_accounts_loginServiceConfiguration` sont creees automatiquement et peuvent etre ignorees |
| **Phase 2 (userId)** | Le champ userId est ajoute mais les publications/methodes peuvent revenir a l'ancienne version (sans filtre). Les documents avec userId restent valides pour le code single-user |
| **Phase 3 (Dual driver)** | Retirer `REMOTE_MONGO_URL` → tout revient en local automatiquement (le `remoteDriver` est `null`) |
| **Phase 4 (Migration)** | La DB locale est intacte. Si la migration echoue : `REMOTE_MONGO_URL` non defini → retour au local. Sur le VPS : `db.dropDatabase()` et recommencer |
| **Phase 5 (Deploy)** | Eteindre l'instance remote. Les users web perdent l'acces mais l'instance locale continue de fonctionner |
| **Phase 6-7 (Fichiers/Qdrant)** | Les fichiers locaux restent. Qdrant peut etre reindexe a tout moment |

### Point de non-retour

Le vrai point de non-retour est quand **plusieurs users ont cree des donnees sur l'instance remote**. A partir de la, revenir au full-local signifie perdre les donnees des autres users. Ce point arrive apres la Phase 5 (deploiement).

**Recommandation** : ne pas ouvrir le signup aux autres users tant que les Phases 1-5 ne sont pas validees et stables.

---

## Decisions prises

| # | Question | Decision | Details |
|---|---|---|---|
| 1 | **Auth bypass en local ?** | **Auth partout** | Mick s'authentifie aussi en local. Coherent, securise, et teste le flow d'auth en continu. |
| 2 | **Signup public ?** | **Signup ouvert** | N'importe qui peut creer un compte. Implique : validation email, rate limiting (`ddp-rate-limiter`), protection anti-abus. |
| 3 | **MongoDB : instance partagee ou dediee ?** | **Reutiliser `organizer-mongodb`** | ~~Container dedie~~ → reutiliser le mongo:5 existant avec une database `panorama` separee. Deja en place, economise de la RAM sur un VPS a 1.9 GB. |
| 4 | **Acces DB depuis le Mac ?** | **Tunnel SSH** | MongoDB bind localhost sur le VPS (port ferme). L'instance locale accede via tunnel SSH. Le tunnel est auto-demarre avec Meteor local (via `autossh` ou script de lancement). |
| 5 | **Denormaliser userId ?** | **Oui** | userId ajoute directement sur noteLines, situation_actors, situation_notes, situation_questions, situation_summaries. Plus simple et performant que les jointures reactives. |
| 6 | **AppPreferences : comment scinder ?** | **Nouvelle collection `userPreferences`** | Separation nette : `appPreferences` garde la config d'instance (filesDir, qdrantUrl), `userPreferences` stocke les prefs par user (theme, cle API, config AI). |
| 7 | **Outil de deploiement ?** | **MUP (Meteor Up)** | Gere build, Docker, Nginx, Let's Encrypt en une commande. Compatible Meteor 3 avec workaround Node 20.9.0. MongoDB et Qdrant geres separement (containers Docker dedies). Fallback : deploy manuel si MUP instable. |
| 8 | **Service SMTP ?** | **Resend** | Compte existant. Config : `EMAIL_URL=smtp://resend:API_KEY@smtp.resend.com:465`. Necessite DNS SPF/DKIM sur le domaine d'expedition. |

## Ordre d'execution recommande

```
Phase 1 (Auth)
    |
    v
Phase 2 (userId partout)  <-- le plus gros, peut etre fait collection par collection
    |
    v
Phase 3 (Dual driver)
    |
    v
Phase 4 (Migration donnees)
    |
    v
Phase 5 (Deploiement VPS)
    |
    v
Phase 6 (Fichiers)       \
    |                      > peuvent etre faites en parallele
Phase 7 (Qdrant)          /
```

Les phases 1 et 2 peuvent etre developpees et testees entierement en local avant de toucher au VPS.

## Risques identifies

| Risque | Impact | Mitigation |
|---|---|---|
| **Latence DB remote depuis le Mac** | Lenteur sur les operations intensives (import bulk, reindex) | Faire ces operations directement sur le VPS |
| **Perte de connexion internet** | L'instance locale ne peut plus lire/ecrire les collections remote | Minimongo client cache les donnees en lecture. Accepter la limitation ou prevoir un mode degrade |
| **Volume de donnees a migrer** | 8 mois de donnees, potentiellement volumineux | L'export NDJSON gzip est deja optimise. Tester sur un sous-ensemble d'abord |
| **Regression sur les features existantes** | L'ajout de userId partout peut casser des queries | Tester chaque collection incrementalement. Garder la DB locale comme backup |
| **Tunnel SSH instable** | Perte de connexion DB si le tunnel tombe | `autossh` avec reconnexion automatique, ou service launchd permanent |
| **Signup ouvert : abus** | Comptes spam, surcharge | Rate limiting, validation email, monitoring |
| **Dual driver Meteor 3** | `MongoInternals.RemoteCollectionDriver` pas documente officiellement dans Meteor 3 | Tester tot. Alternative : `MONGO_URL` pointe directement vers le remote, pas de dual driver (plus simple mais pas de collections locales) |
| **RAM VPS** | ~~Risque resolu~~ — VPS upgrade a 4 GB (fevrier 2026), budget memoire confortable | Monitorer avec `docker stats` apres deploiement |
| **Replica set sur MongoDB partage** | Activer le replica set sur `organizer-mongodb` impacte aussi Organizer | Tester que Organizer (Mongoose) fonctionne correctement apres activation. Normalement transparent |

## Future : projets partages

Non couvert par ce plan. Quand le besoin arrivera, les options sont :
- Champ `sharedWith: [userId]` sur les projets
- Collection `projectMembers` (many-to-many)
- Roles par projet (owner, editor, viewer)

Le fait d'avoir userId partout des maintenant rend cette evolution possible sans refactoring majeur.

## Future : app Android

Pas couverte par ce plan. Approches possibles quand le besoin arrivera :
- **PWA** : le site web Panorama en plein ecran sur Android (zero code natif supplementaire)
- **DDP client** : app native se connectant au protocole Meteor (libraries DDP Kotlin existantes)
- **API REST** : ajouter une couche REST a Panorama (Express middleware dans Meteor, ou serveur separe)
