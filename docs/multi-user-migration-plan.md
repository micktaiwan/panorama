# Plan de migration multi-user

Derniere mise a jour : 2026-02-14. Decisions prises le 2026-02-14.

## Contexte

Panorama est une application locale single-user depuis 8 mois. L'objectif est de la rendre accessible en ligne pour que plusieurs utilisateurs (Mick, David, et d'autres) puissent acceder aux projets, tasks, et notes depuis un navigateur ou une app Android.

### Etat des lieux (fevrier 2026)

L'application est **integralement single-user** :

- **0 package d'authentification** installe (pas de `accounts-base`, `accounts-password`, ni OAuth)
- **0 champ `userId`** sur les 33 collections (exception : `alarms` a un champ `userId` toujours `null`)
- **0 filtre par utilisateur** dans les publications — toutes retournent `Collection.find()` sans filtre
- **0 verification d'identite** dans les methodes — aucune methode ne check `this.userId`
- **1 document global `appPreferences`** pour toute l'app (champs : `filesDir`, `openaiApiKey`, `qdrantUrl`, `theme`, `ai: { mode, embeddingModel, chatModel, ... }`)
- **1 collection Qdrant globale** (`panorama` ou `panorama_<model>`) sans userId dans les payloads
- **Fichiers** servis via route HTTP `/files/` sans aucun controle d'acces
- **Export NDJSON** existant (22 collections), mais **aucune methode d'import** dans le code
- **Route `/tasks-mobile`** existante dans `imports/api/export/server.js` : page HTML server-rendered des tasks ouvertes, activable via flag — precedent d'acces distant

### Fichiers cles du codebase

| Quoi | Chemin |
|---|---|
| Collections | `imports/api/*/collections.js` |
| Methodes (CRUD) | `imports/api/*/methods.js` |
| Publications | `imports/api/*/publications.js` |
| Export petit (JSON) | `imports/api/export/methods.js` → `app.exportAll` |
| Export gros (NDJSON gzip, 22 collections) | `imports/api/export/server.js` → `app.exportArchiveStart` |
| Route `/tasks-mobile` | `imports/api/export/server.js` |
| Config / preferences | `imports/api/appPreferences/` et `imports/api/_shared/config.js` |
| Vector store (Qdrant) | `imports/api/search/vectorStore.js` |
| Route fichiers (upload) | `imports/api/files/methods.js` |
| Route fichiers (download HTTP) | `imports/api/files/methods.js` (WebApp.connectHandlers, sans auth) |
| LLM proxy | `imports/api/_shared/llmProxy.js` |
| Point d'entree serveur | `server/main.js` |
| Point d'entree client | `client/main.jsx` |

### Contraintes

- **Claude Code reste local** : il necessite un shell local, donc l'instance Meteor de Mick continue de tourner sur son Mac
- **L'instance locale de Mick tape sur la DB remote** : les donnees partagees vivent sur le VPS, pas dans `.meteor/local/db`
- **Chaque user ne voit que ses donnees** : pas de projets partages pour l'instant (prevu plus tard)
- **Fichiers sur le disque du VPS** : pas de S3, le VPS OVH (`51.210.150.25`) sert de stockage
- **Qdrant sur le VPS** : recherche semantique accessible depuis tous les clients
- **App Android** : prevue plus tard, pas couverte par ce plan

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

#### 1.4 Proteger l'application

- Wrapper l'App principale : si pas authentifie → redirect vers `#/login`
- Guard sur les routes : les pages ne sont accessibles qu'authentifie
- **Auth partout** : pas de bypass en local, Mick s'authentifie comme tout le monde

#### 1.5 Creer les premiers users

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

C'est un chantier beaucoup plus leger que les 22 collections initialement prevues.

#### 2.4 AppPreferences : scinder en deux collections

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
| Local (Mick) | `mongodb://localhost:3001/meteor` (defaut Meteor) | `mongodb://localhost:27018/panorama` (via tunnel SSH) |
| Remote (VPS) | `mongodb://localhost:27017/panorama` | non defini (tout est local au VPS) |
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

---

### Phase 4 — Migration des donnees existantes

**Objectif** : transferer les 8 mois de donnees locales vers la DB remote.

#### 4.1 Construire la methode d'import

**Il n'existe aucune methode d'import dans le code actuel.** Seul l'export existe (`app.exportArchiveStart` dans `imports/api/export/server.js`, exporte 22 collections en NDJSON gzip). Il faut construire le pendant :

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

#### 4.4 Reindexation Qdrant

1. Installer Qdrant sur le VPS (Docker)
2. Configurer `QDRANT_URL` sur l'instance remote
3. Reindexer tous les documents avec userId dans les payloads
4. L'instance locale de Mick pointe aussi vers le Qdrant du VPS (`QDRANT_URL=http://vps:6333`)

---

### Phase 5 — Deploiement de l'instance remote

**Objectif** : Panorama accessible depuis un navigateur.

#### 5.1 Infrastructure sur le VPS

Composants a deployer :

- **MongoDB** : instance dediee ou partagee (a decider au moment du deploiement)
- **Qdrant** : container Docker (`qdrant/qdrant`)
- **Panorama Meteor** : build et deploiement (voir ci-dessous)
- **Nginx** : reverse proxy, HTTPS (Let's Encrypt)

#### 5.2 Build et deploiement Meteor

```bash
# Build
meteor build --server-only ../output
# Produit un tarball Node.js standard

# Sur le VPS
tar xzf panorama.tar.gz
cd bundle/programs/server && npm install
# Lancer avec PM2 ou Docker
MONGO_URL=mongodb://localhost:27017/panorama \
ROOT_URL=https://panorama.example.com \
PORT=4000 \
node main.js
```

Ou bien dockeriser (recommande pour la reproductibilite).

#### 5.3 Flag isRemote

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

#### 5.4 Securite

- **HTTPS obligatoire** (Nginx + Let's Encrypt)
- **MongoDB** : ne pas exposer le port 27017 sur internet. Connexion locale uniquement (Meteor sur le meme VPS) + tunnel SSH pour l'instance locale de Mick
- **Rate limiting** : `ddp-rate-limiter` (package Meteor built-in) sur les methodes
- **Validation des inputs** : renforcer les `check()` existants
- **CORS** : configurer si l'app Android tape directement sur le DDP

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

## Decisions prises

| # | Question | Decision | Details |
|---|---|---|---|
| 1 | **Auth bypass en local ?** | **Auth partout** | Mick s'authentifie aussi en local. Coherent, securise, et teste le flow d'auth en continu. |
| 2 | **Signup public ?** | **Signup ouvert** | N'importe qui peut creer un compte. Implique : validation email, rate limiting (`ddp-rate-limiter`), protection anti-abus. |
| 3 | **MongoDB : instance partagee ou dediee ?** | **Container Docker dedie** | MongoDB dans un container isole pour Panorama. Meilleure isolation, backups et migrations simplifies. |
| 4 | **Acces DB depuis le Mac ?** | **Tunnel SSH** | MongoDB bind localhost sur le VPS (port ferme). L'instance locale accede via tunnel SSH. Le tunnel est auto-demarre avec Meteor local (via `autossh` ou script de lancement). |
| 5 | **Denormaliser userId ?** | **Oui** | userId ajoute directement sur noteLines, situation_actors, situation_notes, situation_questions, situation_summaries. Plus simple et performant que les jointures reactives. |
| 6 | **AppPreferences : comment scinder ?** | **Nouvelle collection `userPreferences`** | Separation nette : `appPreferences` garde la config d'instance (filesDir, qdrantUrl), `userPreferences` stocke les prefs par user (theme, cle API, config AI). |

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
