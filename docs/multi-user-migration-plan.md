# Plan de migration multi-user

Derniere mise a jour : 2026-02-14. Decisions prises le 2026-02-14.

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
| RAM | 1.9 GB (pas de swap) |
| CPU | 1 vCPU (Intel Haswell) |
| Disque | 20 GB (12 utilisés, 8 libres) |

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
- **RAM limitee** : 1.9 GB total, pas de swap. Le budget memoire est serre — Meteor consomme 200-400 MB en production

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

### Phase 1 — Authentification

**Objectif** : systeme de login fonctionnel, prerequis pour tout le reste.

#### 1.1 Installer les packages Meteor accounts

```bash
meteor add accounts-base accounts-password
```

Optionnel (plus tard) : `accounts-google` pour OAuth.

#### 1.2 Creer l'UI d'authentification

- Page de login (email/password)
- Page de signup ouverte (email/password) — tout le monde peut creer un compte
- Bouton logout dans la navbar
- Composants dans `imports/ui/Auth/Login.jsx`, `imports/ui/Auth/Signup.jsx`
- Routes : `#/login`, `#/signup`

#### 1.3 Securiser le signup ouvert

- Validation email (envoi d'un email de confirmation avant activation)
- Rate limiting sur la creation de compte (`ddp-rate-limiter`)
- Longueur minimale du mot de passe

#### 1.4 Configurer l'envoi d'emails

**Prerequis pour la validation email et le password reset.** Aucun service d'envoi d'email n'est configure actuellement.

- **Service SMTP : Resend** (compte existant)
- Configurer `EMAIL_URL` dans les variables d'environnement Meteor :
  ```
  EMAIL_URL=smtp://resend:re_YOUR_API_KEY@smtp.resend.com:465
  ```
- Verifier que le domaine d'expedition est configure dans Resend (DNS SPF/DKIM)
- Templates d'emails : confirmation de compte, reset de mot de passe
- Adresse d'expedition (ex: `noreply@panorama.example.com`)

#### 1.5 Password reset

Flow "mot de passe oublie" — necessaire des qu'on a un signup ouvert :

- Route `#/forgot-password` : formulaire email → `Accounts.forgotPassword()`
- Route `#/reset-password/:token` : formulaire nouveau mot de passe → `Accounts.resetPassword()`
- Composants dans `imports/ui/Auth/ForgotPassword.jsx`, `imports/ui/Auth/ResetPassword.jsx`
- Depend de la configuration SMTP (1.4)

#### 1.6 Proteger l'application

- Wrapper l'App principale : si pas authentifie → redirect vers `#/login`
- Guard sur les routes : les pages ne sont accessibles qu'authentifie
- **Auth partout** : pas de bypass en local, Mick s'authentifie comme tout le monde

#### 1.7 Creer les premiers users

- Mick et David creent leur compte via le signup ouvert
- Optionnel : role admin pour Mick (gestion des users, si besoin plus tard)

---

### Phase 2 — Multi-tenancy (userId partout)

**Objectif** : chaque document appartient a un user. C'est le plus gros chantier.

#### 2.1 Ajouter userId aux methodes d'ecriture

Pour chaque collection remote, modifier les methodes `insert` :

```javascript
// Avant
async 'projects.insert'(doc) {
  return ProjectsCollection.insertAsync({ ...doc, createdAt: new Date() });
}

// Apres
async 'projects.insert'(doc) {
  const userId = this.userId;
  if (!userId) throw new Meteor.Error('not-authorized');
  return ProjectsCollection.insertAsync({ ...doc, userId, createdAt: new Date() });
}
```

Pour les methodes `update` et `remove`, verifier l'ownership :

```javascript
async 'projects.update'(projectId, modifier) {
  const userId = this.userId;
  if (!userId) throw new Meteor.Error('not-authorized');
  const doc = await ProjectsCollection.findOneAsync({ _id: projectId, userId });
  if (!doc) throw new Meteor.Error('not-found');
  return ProjectsCollection.updateAsync(projectId, { $set: modifier });
}
```

**Helper reutilisable** : creer `imports/api/_shared/auth.js` avec :
- `ensureLoggedIn(userId)` — throw si pas connecte
- `ensureOwner(collection, docId, userId)` — throw si le doc n'appartient pas au user

#### 2.2 Filtrer les publications par userId

```javascript
// Avant
Meteor.publish('projects', function () {
  return ProjectsCollection.find();
});

// Apres
Meteor.publish('projects', function () {
  if (!this.userId) return this.ready();
  return ProjectsCollection.find({ userId: this.userId });
});
```

Pour `noteLines` qui herite du userId via la session : **denormaliser**. Ajouter userId directement sur noteLines (plus simple et performant que des jointures reactives).

#### 2.3 Collections impactees

Les 8 collections remote : `projects`, `tasks`, `notes`, `noteSessions`, `noteLines`, `links`, `files`, `userPreferences`. Pour chacune :
1. Ajouter `userId` a l'insert
2. Filtrer par `userId` dans le find des publications
3. Verifier `userId` dans update/remove
4. Ajouter un index MongoDB sur `{ userId: 1 }` (ou compound `{ userId: 1, projectId: 1 }` etc.)

C'est un chantier beaucoup plus leger que les 21 collections initialement prevues.

#### 2.4 Securiser les methodes d'export

Les methodes `app.exportAll` et `app.exportArchiveStart` n'ont aucun check d'authentification. En multi-user :
- Ajouter `if (!this.userId) throw new Meteor.Error('not-authorized')` aux deux methodes
- Filtrer l'export par userId : n'exporter que les documents du user connecte
- L'export des collections local-only (situations, budget, etc.) reste inchange sur l'instance locale

#### 2.5 Proteger les methodes local-only sur l'instance remote

Les methodes et publications des collections locales (situations, budget, claude, gmail, etc.) sont importees par `server/main.js` sur les deux instances. Sur l'instance remote, ces collections n'existent pas dans la DB — mais les methodes restent appelables.

Options :
- **Guard par methode** : ajouter `if (isRemoteInstance()) throw new Meteor.Error('local-only')` en tete des methodes local-only
- **Import conditionnel** : ne pas importer ces modules dans `server/main.js` quand `isRemoteInstance()` est vrai (plus propre mais plus complexe a mettre en place)

> **Question ouverte** : quelle approche privilegier ? Le guard par methode est plus simple. L'import conditionnel est plus propre mais demande de reorganiser `server/main.js`.

#### 2.6 AppPreferences : scinder en deux collections

Nouvelle collection **`userPreferences`** (remote, avec userId) :
- `theme`, `openaiApiKey`, `ai: { mode, embeddingModel, chatModel, ... }`
- Preferences d'affichage, raccourcis, etc.
- Un document par user

Collection **`appPreferences`** existante (local, sans userId) :
- `filesDir`, `qdrantUrl`, chemins locaux, config MCP
- Config specifique a l'instance/machine

Refactoring de `imports/api/_shared/config.js` :
- `getConfig()` merge les deux sources : userPreferences du user connecte + appPreferences de l'instance en fallback
- Creer `imports/api/userPreferences/collections.js`, `methods.js`, `publications.js`
- Migrer l'UI Preferences pour lire/ecrire dans la bonne collection selon le champ

> **Question ouverte — resolution des prefs cote serveur** : dans les methodes Meteor, `this.userId` est disponible pour charger les userPreferences. Mais le code serveur hors methodes (LLM proxy, background processing, vectorStore) n'a pas de userId en contexte. Options :
> - Passer userId explicitement dans les fonctions serveur qui en ont besoin (ex: `chatComplete({..., userId})`)
> - Pour le code qui tourne hors requete utilisateur (cron, reindex), utiliser les appPreferences d'instance en fallback
> - A clarifier au moment de l'implementation

#### 2.7 Strategie d'indexes

Ajouter des indexes MongoDB sur les collections remote pour eviter les full scans. Indexes recommandes :

| Collection | Index | Justification |
|---|---|---|
| `projects` | `{ userId: 1 }` | Filtre principal des publications |
| `tasks` | `{ userId: 1, projectId: 1 }` | Filtre par user + projet |
| `tasks` | `{ userId: 1, done: 1 }` | Taches ouvertes d'un user |
| `notes` | `{ userId: 1, projectId: 1 }` | Filtre par user + projet |
| `noteSessions` | `{ userId: 1, projectId: 1 }` | Filtre par user + projet |
| `noteLines` | `{ userId: 1, sessionId: 1 }` | Filtre par user + session |
| `links` | `{ userId: 1, projectId: 1 }` | Filtre par user + projet |
| `files` | `{ userId: 1, projectId: 1 }` | Filtre par user + projet |
| `userPreferences` | `{ userId: 1 }` unique | Un document par user |

Creer les indexes avant la migration des donnees (Phase 4) pour que les inserts soient indexes au fil de l'eau.

#### 2.8 Impact sur le MCP Server

Les outils MCP (`imports/api/tools/`) requetent les collections sans filtre userId actuellement. Apres la migration, l'instance locale de Mick tape sur la DB remote qui contient les donnees de tous les users.

**Probleme** : sans filtre userId, les outils MCP retourneraient les donnees de tous les users.

**Solution** : les outils MCP tournent uniquement en local (Claude Code = shell local). L'instance locale connait le user connecte (Mick). Il faut :
- Injecter le `userId` du user connecte dans le contexte des outils MCP
- Modifier les helpers de requete dans `imports/api/tools/helpers.js` pour filtrer par userId
- Adapter `tool_tasksByProject`, `tool_notesByProject`, `tool_semanticSearch`, `tool_collectionQuery`, etc.
- `COMMON_QUERIES` dans `helpers.js` doivent inclure le filtre userId

> **Question ouverte** : comment le MCP server obtient-il le userId ? Options :
> - Variable d'environnement (`PANORAMA_USER_ID`) configuree au lancement local
> - Le MCP server appelle `Meteor.userId()` s'il tourne dans le contexte Meteor
> - Config dans `appPreferences` de l'instance locale (champ `localUserId`)

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
autossh -M 0 -f -N -L 27018:localhost:27017 user@51.210.150.25
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
      username: 'root',  // ou user avec sudo
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

**Specs VPS** : 1.9 GB RAM, 1 vCPU, 20 GB disque (8 GB libres). Pas de swap.

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
| **Total estime** | **~630-780 MB** | Reste ~1.1-1.2 GB pour l'OS et le cache |

**Budget serre mais faisable.** Pour limiter la consommation Meteor :
- `NODE_OPTIONS=--max-old-space-size=256` dans les env vars MUP
- Monitorer avec `docker stats` apres deploiement

**Si la RAM devient insuffisante** :
- Upgrader le VPS OVH (passer a 4 GB = marge confortable)
- Activer du swap (2 GB) comme filet de securite temporaire

#### 5.9 Fallback : deploiement manuel (si MUP ne convient pas)

Si MUP pose des problemes de compatibilite avec Meteor 3, deploiement manuel :

```bash
# Sur le Mac
meteor build --server-only ../output
scp ../output/panorama.tar.gz user@51.210.150.25:/var/www/panorama/

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

#### 7.3 Reindexation

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
| **RAM VPS insuffisante** | Meteor consomme 200-400 MB sur un VPS a 1.9 GB deja charge | `NODE_OPTIONS=--max-old-space-size=256`, monitorer avec `docker stats`. Upgrader vers 4 GB si necessaire |
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
