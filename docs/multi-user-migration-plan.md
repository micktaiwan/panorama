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

Le VPS OVH (`51.210.150.25`) heberge deja le projet **Organizer** et un prototype de Panorama fait par David (Express 5 + React, abandonne — a supprimer).

**Note historique** : David avait nomme son prototype "Panoramix" et deploye des containers `panoramix-api` + `panoramix-web`. Ce nom n'est pas retenu — le projet s'appelle **Panorama**. Les containers de David seront supprimes et remplaces par le deploiement Meteor. La DB `panoramix` sur le VPS peut etre droppee apres la mise en production.

**Specs VPS** :

| Ressource | Valeur |
|---|---|
| RAM | 4 GB (upgrade fevrier 2026, etait 1.9 GB) + swap 2 GB |
| CPU | 2 vCPU (upgrade fevrier 2026, etait 1) |
| Disque | 40 GB (upgrade fevrier 2026, etait 20 GB). Swap: 2 GB (`/swapfile`) |

**Services Docker en place** (apres restructuration Phase 3.6, 2026-02-15) :

L'infra partagee est separee des applications. Prototype de David supprime.

| Container | Image | Docker-compose | Role |
|---|---|---|---|
| `organizer-mongodb` | mongo:5 (replica set `rs0`) | `/opt/infra/docker-compose.yml` | DB partagee, port `127.0.0.1:27017` |
| `organizer-qdrant` | qdrant:v1.16.3 | `/opt/infra/docker-compose.yml` | Vector DB, port `127.0.0.1:6333` |
| `mup-nginx-proxy` | zodern/nginx-proxy | gere par MUP | Reverse proxy SSL (ports 80/443) |
| `mup-nginx-proxy-letsencrypt` | letsencrypt-companion | gere par MUP | Renouvellement auto SSL |
| `organizer-api` | Node.js 20 | `/var/www/organizer/server/docker-compose.prod.yml` | API Organizer (port 3001) |
| `organizer-coturn` | coturn | `/var/www/organizer/server/docker-compose.prod.yml` | TURN server (Organizer) |
| `panorama` | zodern/meteor:root | gere par MUP (`.deploy/mup.js`) | Panorama Meteor (port 3000, reseau `server_organizer-network`) |

**Domaine** : `panorama.mickaelfm.me` deja configure avec SSL Let's Encrypt via le proxy MUP.

**Reseau Docker** : `server_organizer-network` — tous les containers partagent ce reseau interne.

**Backups** : `mongodump` quotidien automatise pour la DB `organizer` (cron 2h UTC, 7j retention, `/opt/backups/`). La DB `panorama` n'a pas encore de backup automatise (a ajouter en Phase 5.7).

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

Note : LOCAL_MONGO_URL n'est pas utilise dans la configuration actuelle.
Toutes les collections vivent sur la DB remote avec userId + ensureLoggedIn.
La distinction local-only/remote a ete supprimee en Phase 3.7.
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
- Methodes : `userPreferences.ensure` (upsert initial + migration one-time), `userPreferences.update` (mise a jour partielle)
- `ensure` inclut une migration one-time (flag `_keysBackfilled`) : copie `openaiApiKey`, `anthropicApiKey`, `perplexityApiKey` et `ai` depuis `appPreferences` si les champs sont `null` dans `userPreferences`. Evite la perte de donnees lors du split appPreferences → userPreferences. Le flag empeche la re-migration si un user efface volontairement une cle.
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
- `PrefsGeneral.jsx` : theme lit/ecrit dans userPreferences. useEffect depend de `[userPref?._id, userPref?.theme]`
- `PrefsSecrets.jsx` : API keys (openai, anthropic, perplexity) lisent/ecrivent dans userPreferences. Placeholders uniformes `"(not set)"`. useEffect depend de `[userPref?._id, ...keyFields]`
- `PrefsAI.jsx` : config AI lit/ecrit dans userPreferences via `userPreferences.update`. useEffect depend de `[userPref?._id, JSON.stringify(userPref?.ai)]`
- `App.jsx` : theme sync lit depuis userPreferences
- **Important** : les useEffect des composants Prefs ne doivent **pas** dependre uniquement de `userPref?._id` — sinon les mises a jour server-side (migration, sync) ne se refletent pas dans l'UI

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

#### ~~Limitation connue — Qdrant non isole par user~~ (RESOLVED — Phase 7 DONE)

L'index Qdrant est desormais **isole par user** : les vecteurs contiennent `userId` dans les payloads, toutes les recherches et indexations filtrent par userId. Voir Phase 7 ci-dessous.

**Note** : apres deploiement, chaque user doit relancer "Rebuild" depuis Preferences > Qdrant pour reindexer avec userId.

---

### Phase 3 — Infrastructure DB remote (DONE)

**Objectif** : l'instance locale de Mick se connecte a la DB remote. Toutes les collections utilisent le meme pattern userId + ensureLoggedIn.

**Statut** : complet. Infra Docker restructuree (3.6), MongoDB TLS + Auth (3.4), collections unifiees (3.7). La distinction local-only/remote a ete supprimee — `localDriver.js`, `ensureLocalOnly()` et `isRemoteInstance()` n'existent plus.

**Note** : `LOCAL_MONGO_URL` n'est pas utilise. Quand `MONGO_URL` pointe vers le VPS, Meteor ne demarre **pas** son MongoDB interne. Toutes les collections utilisent la DB remote.

**Approche inversee** : plutot qu'ajouter un `remoteDriver` sur les 8 collections partagees, `MONGO_URL` pointe directement vers la DB remote. Seules les ~21 collections local-only recoivent un `localDriver`. Avantages :
- `Meteor.users` est automatiquement sur la DB remote (un seul compte, un seul mot de passe, un seul `userId`)
- Les collections partagees ne necessitent **aucune modification**
- En dev/test (pas de `LOCAL_MONGO_URL`), tout reste local — comportement identique a l'existant

#### 3.1 Configurer le local driver

```javascript
// imports/api/_shared/localDriver.js
import { MongoInternals } from 'meteor/mongo';

const localUrl = process.env.LOCAL_MONGO_URL;

export const localDriver = localUrl
  ? new MongoInternals.RemoteCollectionDriver(localUrl)
  : null; // Si pas de LOCAL_MONGO_URL, tout utilise le driver par defaut (dev, tests, VPS)
```

#### 3.2 Modifier les declarations des collections local-only

```javascript
// imports/api/situations/collections.js (exemple — appliquer a toutes les collections local-only)
import { Mongo } from 'meteor/mongo';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

export const SituationsCollection = new Mongo.Collection('situations', driverOptions);
```

Appliquer ce pattern a toutes les collections local-only (~21 fichiers, voir liste en Phase 2 etape 4).

Les collections remote (projects, tasks, notes, noteSessions, noteLines, links, files, userPreferences) ne changent **pas** — elles utilisent le driver par defaut (`MONGO_URL`), qui pointe vers la DB remote.

#### 3.3 Configuration par environnement

| Environnement | MONGO_URL | LOCAL_MONGO_URL | MONGO_OPLOG_URL |
|---|---|---|---|
| Local (Mick) | `mongodb://USER:PASS@panorama.mickaelfm.me:27018/panorama?tls=true&authSource=admin` | non defini | `mongodb://USER:PASS@panorama.mickaelfm.me:27018/local?tls=true&authSource=admin` |
| Remote (VPS) | `mongodb://panorama:PASS@organizer-mongodb:27017/panorama?authSource=admin` (reseau Docker, sans TLS) | non defini | `mongodb://panorama:PASS@organizer-mongodb:27017/local?authSource=admin` |
| Dev/Test | defaut Meteor | non defini | non defini (polling) |

**Comportement par environnement** :
- **Dev/Test** : `MONGO_URL` non defini → Meteor demarre son MongoDB interne → toutes les collections utilisent la DB locale. Comportement identique a l'existant.
- **VPS** : `MONGO_URL` pointe vers la DB remote (reseau Docker, sans TLS). `LOCAL_MONGO_URL` non defini → les collections local-only utilisent aussi la DB remote, mais `ensureLocalOnly()` bloque toutes leurs methodes. Aucun risque d'ecriture accidentelle.
- **Local (Mick)** : `MONGO_URL` pointe vers la DB remote via TLS + auth. Meteor ne demarre **pas** son MongoDB interne quand `MONGO_URL` est defini. `LOCAL_MONGO_URL` non defini → toutes les collections (remote et local-only) utilisent la DB remote. C'est le comportement voulu : les donnees locales sont stockees sur le VPS et protegees par `ensureLocalOnly()` sur l'instance remote.

**Note** : contrairement a ce qui avait ete prevu initialement, Meteor ne demarre **pas** son MongoDB interne quand `MONGO_URL` est defini. Le dual driver n'est donc pas operationnel sans `LOCAL_MONGO_URL`, mais ce n'est pas un probleme : toutes les collections fonctionnent sur la DB remote.

#### 3.4 Connexion MongoDB distante — TLS + Auth ✅ DONE (2026-02-15)

L'instance locale de Mick (et celle de David sur Windows) accede au MongoDB du VPS. Qdrant reste derriere un tunnel SSH.

**Approche abandonnee — tunnel SSH** : le replica set annonce un hostname Docker interne (`organizer-mongodb:27017`). Le driver MongoDB decouvre ce hostname et tente de s'y connecter, ce qui echoue depuis le Mac (hostname non resolvable). `directConnection=true` cause une erreur "Topology is closed" dans Meteor. Les workarounds (`/etc/hosts`, alias loopback `127.0.0.2`, stopper MongoDB local) sont fragiles et ne passent pas a l'echelle (chaque dev doit bidouiller sa machine).

**Approche retenue — MongoDB expose publiquement avec TLS + auth** : MongoDB ecoute sur un port public (27018) avec chiffrement TLS (Let's Encrypt) et authentification SCRAM-SHA-256. Chaque dev a une simple connection string, sans tunnel SSH ni modification systeme.

**Connection string cible** :

```
mongodb://panorama:PASSWORD@panorama.mickaelfm.me:27018/panorama?tls=true&authSource=admin
```

**Note** : pas de `directConnection=true` dans les connection strings Meteor — ca provoquait l'erreur "Topology is closed". Le RS member est reconfigure a `panorama.mickaelfm.me:27018` (hostname public) pour que la decouverte automatique du driver fonctionne.

**Implementation prevue** :

**Etape 1 — Preparation TLS sur le VPS** :
- Creer `/opt/infra/mongodb-tls/`
- Extraire le cert Let's Encrypt du container `mup-nginx-proxy` (fullchain.pem + key.pem → mongodb.pem)
- Generer un keyFile pour l'auth replica set (`openssl rand -base64 756`)
- Script `generate-pem.sh` pour automatiser l'extraction et le renouvellement

**Etape 2 — Modifier `/opt/infra/docker-compose.yml`** :

```yaml
mongodb:
  image: mongo:5
  container_name: organizer-mongodb
  restart: unless-stopped
  command: ["--replSet", "rs0",
    "--tlsMode", "allowTLS",
    "--tlsCertificateKeyFile", "/etc/ssl/mongodb.pem",
    "--tlsCAFile", "/etc/ssl/ca.pem",
    "--tlsAllowConnectionsWithoutCertificates",
    "--keyFile", "/data/keyfile/mongo-keyfile"]
  ports:
    - "127.0.0.1:27017:27017"   # Interne (Docker + localhost)
    - "0.0.0.0:27018:27017"     # Externe (TLS + auth, public)
  volumes:
    - mongodb_data:/data/db
    - /opt/infra/mongodb-tls/mongodb.pem:/etc/ssl/mongodb.pem:ro
    - /opt/infra/mongodb-tls/ca.pem:/etc/ssl/ca.pem:ro
    - /opt/infra/mongodb-tls/mongo-keyfile:/data/keyfile/mongo-keyfile:ro
```

Choix techniques :
- `allowTLS` (pas `preferTLS`) : accepte TLS et non-TLS. `preferTLS` causait des erreurs de validation SSL interne du replica set ("unable to get issuer certificate" — le RS monitor tente TLS pour se connecter a lui-meme). Avec `allowTLS`, les connexions internes restent non-TLS, les clients externes utilisent TLS.
- `--tlsCAFile` : requis par MongoDB 5 meme avec `--tlsAllowConnectionsWithoutCertificates` ("The use of TLS without specifying a chain of trust is no longer supported"). Pointe vers `chain.pem` (CA intermediaire Let's Encrypt).
- `--keyFile` : active l'authentification pour le replica set (SCRAM-SHA-256)
- `--tlsAllowConnectionsWithoutCertificates` : pas de certificat client requis (TLS one-way, comme HTTPS)
- Port 27018 sur `0.0.0.0` : accessible depuis internet, protege par TLS + auth
- **RS member reconfigure** : `rs.reconfig()` pour changer le hostname du member de `organizer-mongodb:27017` a `panorama.mickaelfm.me:27018`. Permet au driver MongoDB de decouvrir le member via le hostname public (sans `directConnection=true`).

**Etape 3 — Creer les utilisateurs MongoDB** (via localhost exception) :

| User | Roles | Usage |
|---|---|---|
| `admin` | `root` sur `admin` | DBA, backups |
| `panorama` | `readWrite` sur `panorama`, `read` sur `local` | App Panorama (oplog) |
| `organizer` | `readWrite` sur `organizer` | App Organizer |

**Etape 4 — Mettre a jour Organizer** :

```
MONGODB_URI=mongodb://organizer:PASS@organizer-mongodb:27017/organizer?authSource=admin&directConnection=true
```

`directConnection=true` empeche Mongoose de decouvrir le RS member et d'essayer de s'y connecter via le hostname public. Note : `directConnection=true` fonctionne bien avec Mongoose (Organizer) mais cause "Topology is closed" avec le driver Meteor — ne pas l'utiliser dans les connection strings Meteor.

**Etape 5 — Ouvrir le firewall port 27018** (iptables + firewall OVH si necessaire)

**Etape 6 — Mettre a jour `start-local.sh`** :
- Supprime le tunnel SSH pour MongoDB (plus besoin)
- Garde le tunnel SSH pour Qdrant
- `MONGO_URL` et `MONGO_OPLOG_URL` pointent vers `panorama.mickaelfm.me:27018` avec `tls=true&authSource=admin` (sans `directConnection=true`)
- Pas de `LOCAL_MONGO_URL` — toutes les collections utilisent la DB remote
- Credentials dans `~/.env.secrets` (`PANORAMA_MONGO_USER`, `PANORAMA_MONGO_PASS`), pas dans le script
- Lance `npm run dev:desktop:4000` (Meteor + Electron)

**Etape 7 — Cron renouvellement cert** : `generate-pem.sh` hebdomadaire (regenere le PEM + restart MongoDB)

**Etape 8 — Mettre a jour le script de backup** : ajouter les credentials auth a `mongodump`

**Retour d'experience — directConnection=true et "Topology is closed"** : l'erreur "Topology is closed" etait causee par `LOCAL_MONGO_URL=mongodb://localhost:4001/meteor` pointant vers un MongoDB inexistant (Meteor ne demarre pas son MongoDB interne quand `MONGO_URL` est defini). La solution : ne pas utiliser `LOCAL_MONGO_URL` du tout, et ne pas utiliser `directConnection=true` dans les connection strings Meteor. Le RS member a ete reconfigure a `panorama.mickaelfm.me:27018` via `rs.reconfig()` pour que la decouverte automatique fonctionne.

**Impact pour David (Windows)** : aucune config systeme. Il clone le repo, definit les variables d'environnement (`PANORAMA_MONGO_USER`, `PANORAMA_MONGO_PASS`), et lance `start-local.sh` (ou l'equivalent Windows). Pas de tunnel SSH, pas de `/etc/hosts`.

**Qdrant** : reste derriere le tunnel SSH (`autossh`, port local 16333 → VPS 6333). Qdrant n'a pas d'auth built-in suffisante pour une exposition publique.

**Rollback** : restaurer `docker-compose.yml` depuis `.bak-pre-tls`, restaurer le docker-compose Organizer, `git checkout start-local.sh`. Les donnees MongoDB sont intactes.

#### 3.5 Replica set, oplog et ports (absorbe par 3.6)

Meteor utilise l'**oplog** (journal des operations MongoDB) pour la reactivite en temps reel. Sans oplog, Meteor poll la DB toutes les ~10 secondes — insuffisant pour une bonne UX.

**Prerequis** : MongoDB doit tourner en **replica set** pour que l'oplog existe. Un replica set n'est pas une DB separee : c'est un mode de fonctionnement de MongoDB qui active le journal des operations. Un single-node suffit (pas besoin de plusieurs serveurs). Actuellement `organizer-mongodb` n'est **pas** en replica set.

**Ces modifications (replica set + ports exposes sur localhost) sont incluses directement dans la Phase 3.6** (restructuration infra Docker). Pas besoin de les faire en deux temps.

**Configuration oplog** : Meteor lit l'oplog via `MONGO_OPLOG_URL` (voir tableau 3.3). Sur le VPS : `mongodb://panorama:PASS@organizer-mongodb:27017/local?authSource=admin`. En local (Mick) : `mongodb://USER:PASS@panorama.mickaelfm.me:27018/local?tls=true&authSource=admin`.

#### 3.6 Restructuration infra Docker ✅ DONE (2026-02-15)

**Objectif** : separer l'infra partagee (MongoDB, Qdrant, reverse proxy) des applications (Organizer, Panorama). Avant, MongoDB et Qdrant etaient definis dans le docker-compose d'Organizer — couplage artificiel.

**Architecture en place** :

```
/opt/infra/docker-compose.yml          → mongodb (replica set rs0), qdrant
/var/www/organizer/server/docker-compose.prod.yml  → api, coturn (reseau externe)
mup-nginx-proxy + letsencrypt          → geres par MUP, autonomes
Panorama                               → a deployer via MUP (Phase 5)
```

**Ce qui a ete fait** :

1. Backup frais `organizer-pre-restructure.gz` (rapatrie en local dans `.backups/`)
2. Checkpoint : Organizer fonctionne (health 200)
3. Prototype de David stoppe et supprime (`/opt/panoramix` → containers `panoramix-api` + `panoramix-web` supprimes)
4. Organizer stoppe
5. Infra partagee demarree depuis `/opt/infra/docker-compose.yml`
6. Docker-compose Organizer simplifie (mongodb/qdrant retires, reseau externe, coturn ajoute)
7. **Replica set initialise AVANT de relancer Organizer** — necessaire car MongoDB en mode `--replSet` refuse les connexions tant que `rs.initiate()` n'est pas fait. L'ordre prevu dans le plan initial (checkpoint Organizer avant rs.initiate) ne fonctionne pas.
8. Organizer relance → healthy, messages desktop↔Android OK

**Corrections par rapport au plan initial** :

- **Reseau `external: true`** : le reseau `server_organizer-network` existait deja (cree par le proxy MUP). Il fallait le declarer `external: true` dans `/opt/infra/docker-compose.yml` au lieu de `driver: bridge` + `name:`, sinon Docker refuse de le reutiliser (conflit de labels).
- **Ordre rs.initiate** : `rs.initiate()` doit etre fait **avant** de relancer Organizer, pas apres. Mongoose ne peut pas se connecter a un MongoDB en mode replica set non initialise (topology "Unknown", timeout 30s).

**`/opt/infra/docker-compose.yml`** (tel que deploye en 3.6, avant TLS — voir 3.4 pour la version avec TLS + Auth) :

```yaml
services:
  mongodb:
    image: mongo:5
    container_name: organizer-mongodb
    restart: unless-stopped
    command: ["--replSet", "rs0"]
    ports:
      - "127.0.0.1:27017:27017"       # accessible via reseau Docker
    volumes:
      - mongodb_data:/data/db
    networks:
      - shared-infra
    logging:
      driver: json-file
      options:
        max-size: "100m"
        max-file: "3"

  qdrant:
    image: qdrant/qdrant:v1.16.3
    container_name: organizer-qdrant
    restart: unless-stopped
    security_opt:
      - seccomp:unconfined
    ports:
      - "127.0.0.1:6333:6333"         # accessible via tunnel SSH
    volumes:
      - qdrant_data:/qdrant/storage
    networks:
      - shared-infra
    environment:
      - QDRANT__SERVICE__GRPC_PORT=6334
      - QDRANT__SERVICE__HTTP_PORT=6333
    logging:
      driver: json-file
      options:
        max-size: "100m"
        max-file: "3"

networks:
  shared-infra:
    external: true                     # reseau existant cree par le proxy MUP
    name: server_organizer-network

volumes:
  mongodb_data:
    external: true
    name: server_mongodb_data
  qdrant_data:
    external: true
    name: server_qdrant_data
```

**`/var/www/organizer/server/docker-compose.prod.yml`** (tel que deploye) :

```yaml
services:
  api:
    build: .
    container_name: organizer-api
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - PORT=3001
      - MONGODB_URI=mongodb://organizer:PASS@organizer-mongodb:27017/organizer?authSource=admin&directConnection=true  # Auth ajoutee en Phase 3.4
      - JWT_SECRET=${JWT_SECRET}
      - CORS_ORIGIN=${CORS_ORIGIN:-*}
      - QDRANT_URL=http://organizer-qdrant:6333
      - LOG_DIR=/app/logs
      - MCP_URL=http://localhost:3001/mcp
      - EKO_MCP_TOKEN=${EKO_MCP_TOKEN}
    volumes:
      - uploads_data:/app/public/uploads
      - apk_data:/app/public/apk
      - logs_data:/app/logs
      - ./agent-config.json:/app/agent-config.json:ro
    networks:
      - server_organizer-network
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    logging:
      driver: json-file
      options:
        max-size: "100m"
        max-file: "3"

  coturn:
    image: coturn/coturn
    container_name: organizer-coturn
    restart: unless-stopped
    networks:
      - server_organizer-network

networks:
  server_organizer-network:
    external: true

volumes:
  uploads_data:
  apk_data:
  logs_data:
```

**Backup** : l'ancien docker-compose Organizer est sauvegarde dans `/var/www/organizer/server/docker-compose.prod.yml.bak`.

---

### Phase 3.7 — Collections unifiees (suppression local/remote) ✅ DONE (2026-02-15)

**Objectif** : supprimer la distinction local-only / remote. Toutes les collections utilisent le meme pattern `userId` + `ensureLoggedIn` + `ensureOwner`.

**Contexte** : avec le TLS + Auth (Phase 3.4), toutes les donnees vivent dans une seule DB remote. `LOCAL_MONGO_URL` n'est pas utilise, `localDriver` est toujours `null`. La distinction "local-only" via `ensureLocalOnly()` est devenue artificielle.

**Ce qui a ete fait** :

1. **Infrastructure supprimee** :
   - `imports/api/_shared/localDriver.js` supprime
   - `ensureLocalOnly()` et `isRemoteInstance()` supprimes de `auth.js`
   - `localDriver` et `driverOptions` retires des 23 fichiers `collections.js`

2. **22 fichiers methods.js migres** (~133 guards remplaces) :
   - `ensureLocalOnly()` remplace par `ensureLoggedIn(this.userId)`
   - `ensureOwner()` ajoute aux methodes update/remove
   - `userId: this.userId` ajoute aux inserts et queries
   - Cas speciaux : `errors/serverConsoleOverride.js` (userId: null), `claudeSessions/processManager.js` (userId en parametre), `cron/jobs.js` (getLocalUserId)

3. **~20 publications corrigees** : filtre `userId: this.userId` ajoute. `errors` utilise `$or: [{userId: this.userId}, {userId: null}]` (erreurs serveur).

4. **MCP tools mis a jour** (`handlers.js`) :
   - `REMOTE_COLLECTIONS` remplace par `GLOBAL_COLLECTIONS = ['appPreferences']`
   - `userId: getMCPUserId()` ajoute aux queries sur toutes les collections sauf appPreferences

5. **Export NDJSON** : `userFilter` ajoute aux collections anciennement locales (sauf appPreferences)

6. **25 indexes `{userId: 1}`** ajoutes dans `server/main.js` pour les collections nouvellement migrees

7. **Backfill userId** : migration au startup avec flag `_userIdBackfilledLocal` dans appPreferences

8. **Integrations migrees vers userPreferences** : pennylane, slack, googleCalendar, calendarIcsUrl, cta. Config async user-aware ajoutee dans `config.js`.

**Impact** : il n'existe plus de distinction local-only / remote. Toutes les collections sont traitees de la meme facon (userId + auth). `PANORAMA_MODE` et `isRemoteInstance` ne sont plus utilises dans le code.

---

### Phase 4 — Migration des donnees existantes ✅ DONE (2026-02-15)

**Objectif** : transferer les 8 mois de donnees locales vers la DB remote.

#### 4.1 Strategie de migration : mongodump/mongorestore

~~L'approche initiale (methode Meteor `app.importArchive` via NDJSON) est abandonnee~~ : le contenu NDJSON transite par DDP qui a une limite de taille de message (~10 MB), insuffisant pour 8 mois de donnees.

**Approche retenue** : `mongodump` / `mongorestore` avec remapping de namespace (`meteor.*` → `panorama.*`). Toutes les collections migrees d'un coup (pas uniquement les remote), userId remappe sur la totalite.

#### 4.2 Ce qui a ete fait

**Etape 1 — Correction pre-migration** : `note_lines` (118 docs) et `note_sessions` (11 docs) n'avaient pas de userId dans la DB locale (le backfill Phase 4.4 les avait marques "deja ok" a tort — ils etaient vides a l'epoque, les docs ont ete crees apres sans userId). Corrige avec `updateMany({userId: {$exists: false}}, {$set: {userId: "y2bayW975C6hocRkh"}})`.

**Etape 2 — Backup propre** : `mongodump` de la DB locale (`meteor`, port 4001) → `.backups/panorama_2026-02-15_pre-migration-clean.gz` (36 collections, 5 549 docs, tous avec userId sauf appPreferences/users/toolCallLogs).

**Etape 3 — Restauration vers la DB remote** :

```bash
source ~/.env.secrets
REMOTE_URI="mongodb://${PANORAMA_MONGO_USER}:${PANORAMA_MONGO_PASS}@panorama.mickaelfm.me:27018/?tls=true&authSource=admin"

mongorestore --gzip \
  --archive=.backups/panorama_2026-02-15_pre-migration-clean.gz \
  --uri="$REMOTE_URI" \
  --nsFrom="meteor.*" --nsTo="panorama.*" \
  --drop \
  --nsExclude="meteor.appPreferences" \
  --nsExclude="meteor.toolCallLogs" \
  --nsExclude="meteor.users" \
  --nsExclude="meteor.userPreferences"
```

**Attention** : l'URI ne doit **pas** contenir le nom de la DB (`/panorama`) — sinon `mongorestore` l'interprete comme `--db` et les flags `--nsFrom`/`--nsTo` sont ignores silencieusement (0 docs restaures sans erreur). Utiliser `/?tls=true&...` au lieu de `/panorama?tls=true&...`.

Resultat : **5 337 docs restaures, 0 echecs**. Collections exclues : `appPreferences` (singleton existant), `users` (compte existant `oinyXGWPpvuvtZfje`), `userPreferences` (existant), `toolCallLogs` (debug local). Index restaures automatiquement.

**Etape 4 — Remap userId** :

Ancien userId (local) : `y2bayW975C6hocRkh` → Nouveau userId (remote) : `oinyXGWPpvuvtZfje`

Remap en deux passes :
1. **7 collections remote** (projects, tasks, notes, note_sessions, note_lines, links, files) : **706 docs**
2. **24 collections local-only** (alarms, budgetLines, calendarEvents, chats, claudeCommands, claudeMessages, claudeProjects, claudeSessions, emailActionLogs, gmailMessages, gmailTokens, mcpServers, notionIntegrations, notionTickets, people, situation_actors, situation_notes, situation_questions, situation_summaries, situations, teams, userLogs, vendorsCache, vendorsIgnore) : **4 629 docs**

Total remappe : **5 335 docs**, 0 restants avec l'ancien userId.

**Etape 5 — Configuration localUserId** : `db.appPreferences.updateOne({}, {$set: {localUserId: "oinyXGWPpvuvtZfje"}})` sur la DB remote.

**Etape 6 — Verification** : app locale relancee avec `MONGO_URL` vers le remote (`start-local.sh`), toutes les donnees visibles et fonctionnelles.

#### 4.3 Migration des fichiers (a faire en Phase 6)

Les fichiers physiques sont dans `~/PanoramaFiles` (ou le chemin configure).

1. `rsync` ou `scp` du repertoire vers le VPS : `/var/www/panorama/files/`
2. Mettre a jour la collection `files` (metadata) pour pointer vers les nouveaux chemins
3. La route HTTP `/files/` du Meteor remote sert les fichiers depuis le disque VPS
4. L'instance locale de Mick garde ses fichiers locaux (pour Claude Code etc.)
5. Les nouveaux fichiers uploades via le web vont directement sur le disque VPS

#### 4.4 Backfill des champs denormalises ✅ DONE (2026-02-15)

Backfill effectue sur la DB locale de Mick (userId `y2bayW975C6hocRkh`), puis corrige avant la migration :

| Collection | Documents backfilles | Note |
|---|---|---|
| projects | 38 | |
| tasks | 260 | |
| notes | 245 | |
| noteSessions | 0 → **11** | Corrige pre-migration (etaient vides lors du backfill initial) |
| noteLines | 0 → **118** | Corrige pre-migration (etaient vides lors du backfill initial) |
| links | 33 | |
| files | 1 | |
| **Total** | **706** | |

#### 4.5 Reindexation Qdrant (Phase 7 DONE)

Qdrant est deja en place sur le VPS (`organizer-qdrant`, v1.16.3, ports 6333/6334).

1. ~~Installer Qdrant~~ → deja fait
2. Configurer `QDRANT_URL=http://organizer-qdrant:6333` sur l'instance remote (reseau Docker)
3. Reindexer tous les documents avec userId dans les payloads
4. L'instance locale de Mick pointe aussi vers le Qdrant du VPS via tunnel SSH (`QDRANT_URL=http://localhost:16333`)

---

### Phase 5 — Deploiement de l'instance remote ✅ DONE (2026-02-15)

**Objectif** : Panorama accessible depuis un navigateur sur `https://panorama.mickaelfm.me`.

**Statut** : deploye et fonctionnel. Container `panorama` sur le VPS, SSL actif, page de login accessible.

#### 5.1 Nom de domaine ✅

`panorama.mickaelfm.me` — SSL Let's Encrypt gere par le proxy MUP existant.

- `ROOT_URL=https://panorama.mickaelfm.me`
- Resend : configurer SPF/DKIM sur `mickaelfm.me` (non fait, emails en console pour l'instant)

#### 5.2 Infrastructure sur le VPS ✅

Aucune nouvelle infra a installer. Tout reutilise l'existant :

- **MongoDB** : `organizer-mongodb` (database `panorama` separee)
- **Qdrant** : `organizer-qdrant` (v1.16.3), accessible via reseau Docker
- **Reverse proxy + SSL** : `mup-nginx-proxy` + letsencrypt companion
- **Panorama Meteor** : nouveau container `panorama`

#### 5.3 Deploiement avec MUP (Meteor Up) ✅

MUP fonctionne avec Meteor 3.4. Le CLI MUP doit tourner sous **Node 20.9.0** (bug SSH avec les versions plus recentes).

**Fichiers crees** :

| Fichier | Role |
|---|---|
| `.deploy/mup.js` | Configuration MUP (serveur, env vars, proxy) |
| `.deploy/settings.json` | Meteor settings (`public.isRemote: true`) |

**Configuration effective** (`.deploy/mup.js`) :

```javascript
module.exports = {
  servers: {
    one: {
      host: '51.210.150.25',
      username: 'ubuntu',
      // Uses ssh-agent (ed25519 key loaded via ssh-add)
    },
  },
  app: {
    name: 'panorama',
    path: '../',
    docker: {
      image: 'zodern/meteor:root',
      args: ['--network=server_organizer-network'],
    },
    servers: { one: {} },
    buildOptions: { serverOnly: true },
    env: {
      ROOT_URL: 'https://panorama.mickaelfm.me',
      MONGO_URL: 'mongodb://panorama:PASS@organizer-mongodb:27017/panorama?authSource=admin',
      MONGO_OPLOG_URL: 'mongodb://panorama:PASS@organizer-mongodb:27017/local?authSource=admin',
      PANORAMA_MODE: 'remote',
      PANORAMA_FILES_DIR: '/var/www/panorama/files',
      QDRANT_URL: 'http://organizer-qdrant:6333',
    },
    deployCheckWaitTime: 120,
  },
  proxy: {
    domains: 'panorama.mickaelfm.me',
    ssl: { letsEncryptEmail: 'faivrem@gmail.com', forceSSL: true },
  },
  // No mongo section — reusing organizer-mongodb
};
```

**Commandes de deploiement** :

```bash
source ~/.env.secrets
nvm exec 20.9.0 mup setup    # first time only
nvm exec 20.9.0 mup deploy
nvm exec 20.9.0 mup logs     # check logs
```

**Ecarts avec le plan initial** :

| Prevu | Reel | Raison |
|---|---|---|
| `pem: '~/.ssh/id_rsa'` | ssh-agent (ed25519) | La cle `id_rsa` est au format OpenSSH (pas PEM), la lib ssh2 de MUP ne la supporte pas. L'agent SSH fonctionne. |
| `PORT: 4000` | Port 3000 (defaut MUP) | MUP ignore `PORT` quand le proxy est active. 3000 est le defaut interne au container, pas de conflit. |
| `METEOR_SETTINGS` dans env | `.deploy/settings.json` | MUP exige un fichier `settings.json` dans `.deploy/` et l'injecte automatiquement comme `METEOR_SETTINGS`. Pas besoin de le passer en env var. |
| Seeder `appPreferences` avec `filesDir`/`qdrantUrl` | Env vars `PANORAMA_FILES_DIR`/`QDRANT_URL` | Le document `appPreferences` est un **singleton partage** entre l'instance locale et remote. Ecrire `filesDir` dedans casserait l'instance locale. Les env vars (`PANORAMA_FILES_DIR`, `QDRANT_URL`) resolvent le probleme sans toucher au document partage — `config.js` les lit en fallback. |
| `EMAIL_URL` (Resend SMTP) | Non configure | Non bloquant. Les emails (verification, reset password) sont affiches dans les logs container (`mup logs`). A ajouter quand Resend est configure. |
| `deployCheckWaitTime: 60` | `deployCheckWaitTime: 120` | Meteor 3 peut etre lent au premier demarrage en production. |
| CSP sans `unsafe-eval` en production | `unsafe-eval` ajoute | Meteor runtime (EJSON, DDP, dynamic imports) utilise `eval()`. Sans `unsafe-eval`, le client crashait avec `EvalError`. Fix dans `server/main.js`. |

**Fix CSP** : le CSP en production n'incluait pas `'unsafe-eval'`, mais le runtime Meteor l'utilise. Le script-src a ete unifie en `script-src 'self' 'unsafe-inline' 'unsafe-eval'` dans `server/main.js` (dev et production).

**Ce que MUP gere** : build Meteor, container Docker app, Nginx reverse proxy config, Let's Encrypt SSL, zero-downtime deploy, logs, restart automatique (Docker restart policy).

**Ce que MUP ne gere PAS** :
- MongoDB : reutilise `organizer-mongodb` existant
- Qdrant : reutilise `organizer-qdrant` existant
- Connexion du proxy au reseau Docker (voir section "Probleme reseau proxy" ci-dessous)
- Backups : a etendre (voir 5.7)

**Seeding `appPreferences`** : pas necessaire. Le document existait deja dans la DB (cree par l'instance locale lors de la Phase 4). Il contient `onboardedAt` (pas de redirection vers l'onboarding) et `localUserId`. Les config specifiques au remote (`filesDir`, `qdrantUrl`) passent par les env vars.

#### 5.3.1 Probleme reseau proxy (resolu, attention requise)

**Probleme** : apres `mup setup`, le proxy nginx ne pouvait pas atteindre le container Panorama. La config nginx generee affichait `# Cannot connect to network of this container`.

**Cause** : MUP demarre le proxy sur le reseau `bridge` uniquement. Panorama est sur `server_organizer-network`. Ils ne partagent aucun reseau → le proxy ne peut pas router le trafic.

**Solution** : connecter le proxy au reseau partage apres son demarrage. Le script de demarrage du proxy (`/opt/mup-nginx-proxy/config/start.sh`) a ete modifie pour ajouter automatiquement cette connexion :

```bash
# Ligne ajoutee apres le bloc "docker network connect mup-proxy"
# dans /opt/mup-nginx-proxy/config/start.sh :
docker network connect server_organizer-network $APPNAME 2>/dev/null || true
```

La config nginx resultante contient deux entrees dans l'upstream : un `server 127.0.0.1 down;` (artefact de la detection initiale) et le vrai `server 172.18.0.x:3000;`. nginx utilise le serveur actif — c'est le comportement attendu de jwilder/nginx-proxy.

**⚠️ ATTENTION** : un futur `mup setup` pourrait ecraser le script de demarrage du proxy et perdre cette modification. Apres chaque `mup setup`, verifier que la ligne `docker network connect server_organizer-network` est toujours presente dans `/opt/mup-nginx-proxy/config/start.sh`. Si elle est absente, la re-ajouter et relancer le proxy.

#### 5.4 Flag isRemote

Deux mecanismes complementaires pour distinguer les instances :

- **Serveur** : `process.env.PANORAMA_MODE === 'remote'` (env var dans `mup.js`)
- **Client** : `Meteor.settings?.public?.isRemote === true` (injecte via `.deploy/settings.json`)

**Important** : le client ne peut PAS lire les env vars serveur. Le flag client passe par `Meteor.settings.public`, configure dans `.deploy/settings.json` et injecte automatiquement par MUP.

**Statut** : les flags sont deployes mais **le UI gating n'est pas encore implemente**. Toutes les pages sont visibles sur l'instance remote. Les methodes serveur protegent les donnees via `ensureLoggedIn + ensureOwner`, donc pas de risque de securite, mais l'UX n'est pas optimale (l'utilisateur voit des menus pour des features inutiles en remote comme Claude Code, MCP, situations, budget, etc.).

A faire : implementer `isRemoteInstance()` cote client et masquer les features local-only dans l'UI.

#### 5.5 Securite

- **HTTPS obligatoire** ✅ (Nginx + Let's Encrypt, `forceSSL: true`)
- **MongoDB** : port 27017 Docker interne (sans TLS). Port 27018 public (TLS + auth SCRAM-SHA-256) ✅
- **Rate limiting** : `ddp-rate-limiter` sur createUser/login/forgotPassword ✅ (configure en Phase 1 dans `server/accounts.js`)
- **Validation des inputs** : a renforcer (actuellement `check(doc, Object)` sans validation des champs individuels)
- **CORS** : non configure (pas de besoin immediat)
- **CSP** : `script-src 'self' 'unsafe-inline' 'unsafe-eval'` — `unsafe-eval` necessaire pour le runtime Meteor

#### 5.6 Securiser les routes HTTP existantes

⚠️ **Non fait** — a traiter avant d'ouvrir le signup aux autres users.

| Route | Statut | Action requise |
|---|---|---|
| `/files/<name>` | ❌ Pas d'auth | Ajouter auth (cookie session ou token). Detaille en Phase 6 |
| `/tasks-mobile` | ❌ Pas d'auth | Ajouter auth (cookie session, basic auth, ou token dans l'URL) |
| `/download-export/<jobId>` | ❌ Pas d'auth | Ajouter auth + verifier que l'export appartient au user |
| `/oauth/google-calendar/callback` | ⚠️ Ouvert | Pas de risque immediat (callback OAuth), mais masquer sur l'instance remote si besoin |

#### 5.7 Monitoring et backups

⚠️ **Non fait** — a traiter avant la mise en production.

**Backups MongoDB** :
- Le script `/usr/local/bin/backup-organizer.sh` existe (cron quotidien 2h UTC, 7j retention, `mongodump --db organizer`)
- **A etendre** : ajouter `--db panorama` au script (ou creer un second cron `backup-panorama.sh`)

**Monitoring** :
- MUP gere le restart automatique du container (Docker `--restart=always`)
- Uptime monitoring externe (UptimeRobot) sur `https://panorama.mickaelfm.me` — a configurer

#### 5.8 Sizing VPS et budget memoire ✅

**Mesures reelles apres deploiement** (2026-02-15) :

| Container | RAM reelle | Estimation initiale |
|---|---|---|
| `panorama` | **172 MB** | 250-400 MB |
| `organizer-mongodb` | 199 MB | ~170 MB |
| `organizer-api` | 63 MB | ~97 MB |
| `organizer-qdrant` | 37 MB | ~30 MB |
| `openclaw-gateway` | 412 MB | (non prevu dans le plan) |
| `mup-nginx-proxy` | 108 MB | ~58 MB |
| `mup-nginx-proxy-letsencrypt` | 34 MB | ~20 MB |
| `organizer-coturn` | 9 MB | ~6 MB |
| **Total** | **~1.2 GB** | ~630-780 MB |

Le total est plus eleve que prevu a cause de `openclaw-gateway` (412 MB) qui n'etait pas dans l'estimation. Avec 3.7 GB de RAM, il reste ~2.2 GB disponibles — confortable.

#### 5.9 Fallback : deploiement manuel

Non utilise — MUP fonctionne bien avec Meteor 3.4. Garde en reserve.

**CI/CD (plus tard)** : GitHub Actions qui build + deploy sur push vers `main`, a envisager quand les deploys deviennent frequents.

#### 5.10 Points d'attention pour la suite

**Avant d'ouvrir le signup** (bloquant) :

1. **Routes HTTP non securisees** (5.6) : `/files/`, `/tasks-mobile`, `/download-export/` n'ont pas d'auth. Un utilisateur non authentifie pourrait acceder aux fichiers si le nom du fichier est devinable.
2. **Backup automatise** (5.7) : la DB `panorama` n'a pas de backup automatise. Si le disque ou la DB corrompt, les donnees sont perdues.
3. ~~**Qdrant non isole par user** (Phase 7)~~ : DONE — les vecteurs contiennent `userId`, les recherches et indexations filtrent par user.

**Apres le deploiement** (non bloquant, ameliore l'UX) :

4. **UI gating** (5.4) : implementer `isRemoteInstance()` cote client pour masquer les features local-only (Claude Code, MCP, situations, budget, calendrier, gmail, notion, alarms, chat AI, userLogs). Actuellement tout est visible — pas de risque securitaire (les methodes protegent les donnees), mais UX confuse pour les nouveaux users.
5. **EMAIL_URL** : configurer le SMTP Resend pour l'envoi reel d'emails (verification de compte, reset password). Sans cela, les emails sont affiches dans les logs container uniquement.
6. **Monitoring uptime** : configurer UptimeRobot (gratuit) pour alerter si `https://panorama.mickaelfm.me` tombe.

**Maintenance recurrente** :

7. **Script proxy** : le script `/opt/mup-nginx-proxy/config/start.sh` a ete modifie pour connecter le proxy au reseau `server_organizer-network`. Un futur `mup setup` peut ecraser ce script. Toujours verifier apres un `mup setup`.
8. **Redeploy** : `source ~/.env.secrets && nvm exec 20.9.0 mup deploy` depuis `.deploy/`. Le ssh-agent doit avoir la cle ed25519 chargee (`ssh-add -l` pour verifier).

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

**Statut** : DONE (2026-02-15). Prerequis avant deploiement multi-user en production.

**Reindexation requise** : apres deploiement, chaque user doit relancer "Rebuild" depuis Preferences > Qdrant pour reindexer ses vecteurs avec userId dans les payloads. Les anciens points sans userId ne sont plus visibles dans les recherches filtrees.

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
| **Phase 3 (Dual driver)** | Retirer `MONGO_URL` → Meteor demarre sa DB interne, tout revient en local automatiquement. `LOCAL_MONGO_URL` n'est pas utilise. |
| **Phase 4 (Migration)** | La DB locale est intacte (`.meteor/local/db`). Si la migration echoue : retirer `MONGO_URL` → retour au local. Sur le VPS : `db.dropDatabase()` et recommencer |
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
| 4 | **Acces DB depuis le Mac ?** | **TLS + Auth public** | ~~Tunnel SSH~~ → MongoDB expose sur port 27018 avec TLS (Let's Encrypt, mode `allowTLS`) + auth (SCRAM-SHA-256). RS member reconfigure a `panorama.mickaelfm.me:27018`. Connection string directe, sans tunnel, sans `directConnection=true`, sans `/etc/hosts`. |
| 5 | **Denormaliser userId ?** | **Oui** | userId ajoute directement sur noteLines, situation_actors, situation_notes, situation_questions, situation_summaries. Plus simple et performant que les jointures reactives. |
| 6 | **AppPreferences : comment scinder ?** | **Nouvelle collection `userPreferences`** | Separation nette : `appPreferences` garde la config d'instance (filesDir, qdrantUrl), `userPreferences` stocke les prefs par user (theme, cle API, config AI). |
| 7 | **Outil de deploiement ?** | **MUP (Meteor Up)** | Gere build, Docker, Nginx, Let's Encrypt en une commande. Compatible Meteor 3 avec workaround Node 20.9.0. MongoDB et Qdrant geres separement (containers Docker dedies). Fallback : deploy manuel si MUP instable. |
| 8 | **Service SMTP ?** | **Resend** | Compte existant. Config : `EMAIL_URL=smtp://resend:API_KEY@smtp.resend.com:465`. Necessite DNS SPF/DKIM sur le domaine d'expedition. |
| 9 | **Direction du dual driver ?** | **Inversee : MONGO_URL → remote** | `MONGO_URL` pointe vers la DB remote (VPS). Un `localDriver` est cree pour les ~21 collections local-only. Resout le probleme de `Meteor.users` (automatiquement sur la DB remote, un seul compte). En dev/test, pas de `LOCAL_MONGO_URL` → tout reste local. |
| 10 | **Replica set ?** | **Requis** | Necessaire pour l'oplog et la reactivite temps reel de Meteor. Single-node replica set sur `organizer-mongodb`. Impact Organizer a verifier (normalement transparent pour Mongoose). |

## Ordre d'execution recommande

```
Phase 1 (Auth)            ✅ DONE
    |
    v
Phase 2 (userId partout)  ✅ DONE
    |
    v
Phase 3.1-3.3 (Code dual driver)  ✅ DONE
    |
    v
Phase 3.6 (Restructuration infra VPS)  ✅ DONE (2026-02-15)
    |
    v
Phase 3.4 (MongoDB TLS + Auth public)  ✅ DONE (2026-02-15)
    |
    v
Phase 3.7 (Unified collections)  ✅ DONE (2026-02-15)
    |
    v
Phase 4 (Migration donnees)  ✅ DONE (2026-02-15)
    |
    v
Phase 5 (Deploiement VPS)  ✅ DONE (2026-02-15)
    |
    v
Phase 6 (Fichiers)          <-- PROCHAINE ETAPE
    |
    v
Phase 7 (Qdrant)          ✅ DONE (2026-02-15)
```

Les phases 1-5 et 7 sont terminees. Prochaine etape : securiser les routes HTTP (5.6), fichiers (Phase 6).

## Risques identifies

| Risque | Impact | Mitigation |
|---|---|---|
| **Latence DB remote depuis le Mac** | Lenteur sur les operations intensives (import bulk, reindex) | Faire ces operations directement sur le VPS |
| **Perte de connexion internet** | L'instance locale ne peut plus lire/ecrire les collections remote | Minimongo client cache les donnees en lecture. Accepter la limitation ou prevoir un mode degrade |
| **Volume de donnees a migrer** | 8 mois de donnees, potentiellement volumineux | L'export NDJSON gzip est deja optimise. Tester sur un sous-ensemble d'abord |
| **Regression sur les features existantes** | L'ajout de userId partout peut casser des queries | Tester chaque collection incrementalement. Garder la DB locale comme backup |
| **Tunnel SSH instable (Qdrant)** | Perte de recherche semantique si le tunnel Qdrant tombe | `autossh` avec reconnexion automatique. MongoDB n'est plus concerne (TLS + Auth direct) |
| **Signup ouvert : abus** | Comptes spam, surcharge | Rate limiting, validation email, monitoring |
| **Local driver Meteor 3** | `MongoInternals.RemoteCollectionDriver` pour le `localDriver` pas documente officiellement dans Meteor 3 | Tester tot en dev. Si probleme, les collections local-only restent dans la DB remote mais protegees par `ensureLocalOnly()` (fallback acceptable) |
| **RAM VPS** | ~~Risque resolu~~ — VPS upgrade a 4 GB (fevrier 2026), budget memoire confortable | Monitorer avec `docker stats` apres deploiement |
| **Replica set sur MongoDB partage** | ~~Risque resolu~~ — replica set active le 2026-02-15, Organizer fonctionne normalement (Mongoose transparent). Note : `rs.initiate()` doit etre fait **avant** de relancer les apps clientes | — |

## Future : rotation des logs

Les collections de logs locales n'ont pas de mecanisme de purge automatique (sauf `toolCallLogs` qui a un TTL index de 30 jours). A mettre en place :

| Collection | Volume actuel | Action |
|---|---|---|
| `errors` | ~9500 docs/8 mois (purges le 2026-02-15) | Ajouter TTL index ou purge periodique |
| `toolCallLogs` | TTL 30 jours deja en place | OK |
| `claudeMessages` | Croissant | Evaluer si purge necessaire |
| `userLogs` | Faible | Pas urgent |

Options :
- **TTL index MongoDB** : `{ createdAt: 1 }, { expireAfterSeconds: N }` — automatique, zero maintenance
- **Meteor method** : `errors.removeOld` existe deja, a appeler via cron ou startup
- **Script bash** : purge via `mongosh` dans un cron

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
