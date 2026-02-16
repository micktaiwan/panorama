# Migration : Projets partagés & Invitations

## Contexte

Panorama est aujourd'hui **mono-utilisateur par design** : chaque document porte un `userId` unique, chaque publication filtre `{ userId: this.userId }`, chaque mutation vérifie `ensureOwner(collection, docId, userId)`. Aucun partage n'est possible.

## Objectif

Permettre de **partager un projet** avec d'autres utilisateurs. Tous les documents enfants (tasks, notes, noteSessions, noteLines, links, files) deviennent visibles et éditables par les membres du projet.

## Décisions de design

| Question | Décision |
|---|---|
| Granularité du partage | **Niveau projet** (option "umbrella") |
| Rôles (owner/editor/viewer) | **Pas pour l'instant** — accès binaire : membre ou pas |
| Docs orphelins (sans projectId) | **Restent privés** au créateur |
| Invitation | **Par email** — lookup en base, ajout immédiat si l'utilisateur existe |
| Envoi d'email | **Non** — pas d'EMAIL_URL configuré, tout se fait en UI |
| Quitter un projet | **Non** — un membre ne peut pas quitter un projet, seul le owner peut retirer un membre |
| Retrait d'un membre | **Les données restent** — les docs créés par le membre restent dans le projet |
| Suppression de projet | **Cascade** — seul le owner peut supprimer, tous les docs enfants sont supprimés |
| Suppression d'un user | **Cascade partielle** — ses projets non-partagés sont supprimés en cascade ; il est retiré des `memberIds` des projets partagés |
| MCP | **Différé** — `localUserId` reste mono-user pour l'instant |

---

## 1. Schéma : `memberIds` sur les projets

### Avant

```js
{ _id, name, userId, description, status, createdAt, updatedAt, ... }
```

### Après

```js
{ _id, name, userId, memberIds: [userId], description, status, createdAt, updatedAt, ... }
```

- `userId` = **créateur/owner** (inchangé, garde le contrôle exclusif : suppression du projet, gestion des membres)
- `memberIds` = **liste de tous les users ayant accès** (inclut le owner)
- A la création d'un projet, `memberIds` est initialisé à `[this.userId]`

### Migration des données existantes

```js
// server/main.js — migration one-shot au démarrage
const projectsWithoutMembers = await ProjectsCollection.find(
  { memberIds: { $exists: false } }
).fetchAsync();

for (const p of projectsWithoutMembers) {
  await ProjectsCollection.updateAsync(p._id, {
    $set: { memberIds: [p.userId] }
  });
}
```

### Index MongoDB

```js
ProjectsCollection.rawCollection().createIndex({ memberIds: 1 });
```

---

## 2. Auth : nouveau helper `ensureProjectAccess`

Dans `imports/api/_shared/auth.js` :

```js
/**
 * Verify that userId is a member of the project.
 * Returns the project doc if access granted; throws 'not-found' otherwise.
 */
export const ensureProjectAccess = async (projectId, userId) => {
  const project = await ProjectsCollection.findOneAsync({
    _id: projectId,
    memberIds: userId,
  });
  if (!project) {
    throw new Meteor.Error('not-found', 'Project not found');
  }
  return project;
};
```

`ensureOwner` reste inchangé — utilisé pour les opérations réservées au owner (supprimer le projet, gérer les membres).

---

## 3. Publications : `$or` owner OU membre

### Pattern actuel (toutes les pubs)

```js
return Collection.find({ userId: this.userId });
```

### Nouveau pattern pour les collections liées à un projet

```js
// Récupérer les IDs des projets dont l'user est membre
const memberProjects = await ProjectsCollection.find(
  { memberIds: this.userId },
  { fields: { _id: 1 } }
).fetchAsync();
const projectIds = memberProjects.map(p => p._id);

return Collection.find({
  $or: [
    { userId: this.userId },                    // Docs perso (dont orphelins)
    { projectId: { $in: projectIds } },         // Docs de projets partagés
  ]
});
```

### Collections impactées

| Collection | Publication à modifier | Notes |
|---|---|---|
| `projects` | `projects` | `{ memberIds: this.userId }` directement |
| `tasks` | `tasks`, `tasks.calendar.*` | Ajouter `$or` avec projectIds |
| `notes` | `notes`, `notes.byClaudeProject` | idem |
| `noteSessions` | `noteSessions` | idem |
| `noteLines` | `noteLines` | Ajouter `projectId` (migration) — même pattern `$or` que les autres |
| `links` | `links` | idem |
| `files` | `files` | idem |

### Collections NON impactées (restent userId seul)

`people`, `teams`, `budget`, `alarms`, `userLogs`, `chats`, `situations*`, `claudeSessions`, `releases`, `userPreferences`, `emails`

---

## 4. Methods : `ensureProjectAccess` au lieu de `ensureOwner`

### Règle générale

Pour les opérations sur des docs liés à un projet partagé :

- **Lecture** : autorisée si `userId ∈ project.memberIds`
- **Création dans un projet** : autorisée si membre du projet
- **Modification** : autorisée si membre du projet (pas besoin d'être le créateur du doc)
- **Suppression** : autorisée si membre du projet (pas besoin d'être le créateur du doc)

### Exemple : `tasks.update`

```js
// Avant
await ensureOwner(TasksCollection, taskId, this.userId);

// Après
const task = await TasksCollection.findOneAsync(taskId);
if (!task) throw new Meteor.Error('not-found', 'Task not found');
if (task.projectId) {
  await ensureProjectAccess(task.projectId, this.userId);
} else {
  // Doc orphelin → seul le créateur peut modifier
  if (task.userId !== this.userId) {
    throw new Meteor.Error('not-found', 'Task not found');
  }
}
```

### Opérations réservées au owner du projet

- `projects.remove` — seul le owner peut supprimer
- `projects.addMember` / `projects.removeMember` — seul le owner gère les membres
- Un membre **ne peut pas quitter** un projet de lui-même

---

## 5. Tasks : ajout de `assigneeId`

### Avant

`userId` sert à la fois de créateur et d'assigné implicite.

### Après

```js
{
  _id, title, status, projectId,
  userId,                // Créateur (inchangé)
  assigneeId,            // Assigné (nouveau, optionnel, un seul user)
  ...
}
```

- A la création, `assigneeId` = `this.userId` (le créateur s'auto-assigne par défaut)
- Réassignable à tout membre du projet (`assigneeId` doit être dans `project.memberIds`)
- Si pas de `projectId` (tâche orpheline), `assigneeId` reste le créateur

### Migration

```js
const tasksWithoutAssignee = await TasksCollection.find(
  { assigneeId: { $exists: false } }
).fetchAsync();

for (const t of tasksWithoutAssignee) {
  await TasksCollection.updateAsync(t._id, {
    $set: { assigneeId: t.userId }
  });
}
```

### Index

```js
TasksCollection.rawCollection().createIndex({ assigneeId: 1 });
```

---

## 6. NoteLines : ajout de `projectId`

### Problème

Les `noteLines` sont liées aux `noteSessions` via `sessionId`, mais n'ont pas de `projectId` direct. Sans `projectId`, impossible d'utiliser le pattern `$or` standard dans les publications.

### Solution

Ajouter `projectId` aux noteLines, dénormalisé depuis la session parente.

### Schéma après

```js
{
  _id, sessionId, content, userId,
  projectId,  // Nouveau — copié depuis la noteSession parente
  createdAt
}
```

### Migration

```js
const sessions = await NoteSessionsCollection.find(
  { projectId: { $exists: true, $ne: null } },
  { fields: { _id: 1, projectId: 1 } }
).fetchAsync();

for (const session of sessions) {
  await NoteLinesCollection.rawCollection().updateMany(
    { sessionId: session._id, projectId: { $exists: false } },
    { $set: { projectId: session.projectId } }
  );
}
```

### A maintenir

- `noteLines.insert` : copier `projectId` depuis la session parente
- `noteSessions.update` (changement de projet) : propager le nouveau `projectId` à toutes les noteLines de la session

### Index

```js
NoteLinesCollection.rawCollection().createIndex({ projectId: 1 });
```

---

## 7. Gestion des membres

### Nouvelle méthode `projects.addMember`

```js
async 'projects.addMember'(projectId, email) {
  check(projectId, String);
  check(email, String);
  ensureLoggedIn(this.userId);
  await ensureOwner(ProjectsCollection, projectId, this.userId);

  const targetUser = await Meteor.users.findOneAsync(
    { 'emails.address': email.trim().toLowerCase() },
    { fields: { _id: 1 } }
  );
  if (!targetUser) {
    throw new Meteor.Error('user-not-found', 'No user found with this email');
  }

  await ProjectsCollection.updateAsync(projectId, {
    $addToSet: { memberIds: targetUser._id }
  });

  return targetUser._id;
}
```

### Nouvelle méthode `projects.removeMember`

```js
async 'projects.removeMember'(projectId, memberId) {
  check(projectId, String);
  check(memberId, String);
  ensureLoggedIn(this.userId);
  await ensureOwner(ProjectsCollection, projectId, this.userId);

  // Le owner ne peut pas se retirer lui-même
  const project = await ProjectsCollection.findOneAsync(projectId);
  if (project.userId === memberId) {
    throw new Meteor.Error('cannot-remove-owner', 'Cannot remove the project owner');
  }

  await ProjectsCollection.updateAsync(projectId, {
    $pull: { memberIds: memberId }
  });

  // Nettoyer les tasks assignées au membre retiré
  await TasksCollection.updateAsync(
    { projectId, assigneeId: memberId },
    { $set: { assigneeId: null } },
    { multi: true }
  );
}
```

### UI

Dans les settings du projet, ajouter une section "Members" :

- Champ input email + bouton "Add"
- Liste des membres actuels avec bouton "Remove" (sauf le owner)
- Feedback immédiat : "User not found" si l'email n'existe pas en base

---

## 8. Sécurisation des fichiers

### Problème

La route `/files/:storedFileName` vérifie aujourd'hui l'authentification par session mais pas l'appartenance au projet.

### Solution

Vérifier que l'utilisateur connecté est membre du projet auquel le fichier appartient :

```js
// Dans la route de serving des fichiers
const file = await FilesCollection.findOneAsync({ storedFileName });
if (!file) return res.status(404).end();

if (file.projectId && file.projectId !== '__none__') {
  // Fichier lié à un projet → vérifier membership
  const project = await ProjectsCollection.findOneAsync({
    _id: file.projectId,
    memberIds: req.userId,
  });
  if (!project) return res.status(404).end();
} else {
  // Fichier orphelin → seul le créateur y a accès
  if (file.userId !== req.userId) return res.status(404).end();
}
```

### Route interne (VPS → local)

La route interne `/api/files/*` (protégée par `X-API-Key`) reste inchangée — elle sert les fichiers bruts pour l'instance locale. La vérification d'accès se fait côté Meteor avant d'appeler cette route.

---

## 9. Qdrant / Recherche sémantique

### Problème

Les vecteurs Qdrant portent un `userId` pour le filtrage. Un doc partagé n'a qu'un seul `userId` (le créateur) → les autres membres ne le trouvent pas via la recherche.

### Solution

Remplacer `userId` par `memberIds` dans les payloads Qdrant :

```js
await upsertDoc({
  kind: 'task',
  id: taskId,
  text: '...',
  projectId,
  memberIds: project.memberIds,  // au lieu de userId
});
```

Et filtrer côté recherche :

```js
// Avant
filter: { must: [{ key: 'userId', match: { value: userId } }] }

// Après
filter: { must: [{ key: 'memberIds', match: { any: [userId] } }] }
```

### Migration

Rebuild complet des vecteurs nécessaire (Preferences > Qdrant > Rebuild).

---

## 10. Cycle de vie

### Retrait d'un membre

Quand le owner retire un membre d'un projet :

- **Les docs créés par le membre restent** dans le projet (tasks, notes, etc.)
- **Les tasks assignées** au membre retiré : `assigneeId` est remis à `null` (fait dans `projects.removeMember`)
- Le membre perd immédiatement l'accès via la publication (réactivité Meteor)

### Suppression d'un user

Quand un compte utilisateur est supprimé :

- **Projets personnels** (non-partagés, `memberIds.length === 1`) → supprimés en cascade (comme `projects.remove`)
- **Projets partagés dont il est owner** → ownership transféré au premier autre membre, userId retiré de `memberIds`
- **Projets partagés dont il est membre** (pas owner) → retiré de `memberIds`, ses docs restent
- **Tasks assignées** à cet user → `assigneeId` remis à `null`

---

## 11. Sécurité — points d'attention

- **Pas de fuite d'information** : les erreurs restent `'not-found'` (pas `'not-authorized'`)
- **Owner seul** peut : supprimer le projet, ajouter/retirer des membres
- **Membres** peuvent : lire et modifier tous les docs du projet (tasks, notes, etc.)
- **Docs orphelins** : accessibles uniquement par leur `userId` (créateur)
- **Cascade suppression** : quand le owner supprime un projet, tous les docs enfants sont supprimés — y compris ceux créés par d'autres membres
- **Retrait d'un membre** : ses docs restent dans le projet, ses tasks assignées passent à `null`
- **Suppression d'un user** : projets perso supprimés en cascade, retiré des projets partagés, ownership transféré si nécessaire
- **Route fichiers** : vérifie `memberIds` du projet avant de servir le fichier

---

## 12. Risques et compromis

| Risque | Mitigation |
|---|---|
| Performance des publications avec `$or` + `$in` | Index `memberIds` + `projectId` sur chaque collection |
| Cascade delete supprime les docs d'autres users | Acceptable : le owner a le contrôle, c'est documenté |
| Pas de rôles → un membre peut tout modifier | OK pour l'usage actuel (confiance entre membres), évolutif plus tard |
| MCP `localUserId` ne voit pas les projets partagés | Différé — à traiter quand le MCP sera multi-user |
| Qdrant rebuild nécessaire | One-shot, déjà un mécanisme en place |

---

## 13. Roadmap

### Phase 1 — Partage de projets (MVP)

- [ ] Migration schema : `memberIds` sur les projets, `projectId` sur les noteLines
- [ ] Index MongoDB (`memberIds`, `projectId` noteLines)
- [ ] `ensureProjectAccess` helper
- [ ] `projects.insert` : init `memberIds: [this.userId]`
- [ ] `projects.addMember` / `projects.removeMember` (avec cleanup `assigneeId`)
- [ ] Publications avec `$or` (projects, tasks, notes, noteSessions, noteLines, links, files)
- [ ] Methods enfants : `ensureProjectAccess` au lieu de `ensureOwner`
- [ ] `noteLines.insert` : copier `projectId` depuis la session
- [ ] Sécurisation route fichiers (`memberIds`)
- [ ] UI : section "Members" dans les settings du projet
- [ ] Tests

### Phase 2 — Assignation des tasks

- [ ] Migration schema : `assigneeId` sur les tasks + index MongoDB
- [ ] Méthode `tasks.assign` (validation membership)
- [ ] Publication des membres du projet (noms/emails pour le dropdown)
- [ ] UI : sélecteur d'assignation dans les tasks
- [ ] Filtrage des tasks par assignee

### Phase 3 — Qdrant multi-user

- [ ] Adapter les payloads (`memberIds` au lieu de `userId`)
- [ ] Adapter les filtres de recherche
- [ ] Rebuild complet des vecteurs

### Phase 4 — Gestion du cycle de vie

- [ ] Suppression d'un user : cascade projets perso, transfert ownership, nettoyage `assigneeId`
- [ ] Retrait d'un membre : nettoyage `assigneeId`

### Phase 5 — Invitations par email

Aujourd'hui, on ne peut ajouter que des users déjà inscrits (lookup par email en base). Pour inviter des personnes sans compte :

- [ ] Intégrer Resend (ou équivalent) pour l'envoi d'emails transactionnels
- [ ] Collection `pendingInvitations` : `{ projectId, email, invitedBy, token, createdAt, expiresAt }`
- [ ] Envoi d'un email d'invitation avec lien d'inscription contenant le token
- [ ] A l'inscription, résolution automatique des invitations en attente (ajout aux `memberIds`)
- [ ] UI : afficher les invitations en attente dans la section Members (avec option d'annulation)
- [ ] Expiration des invitations (ex: 7 jours)

### Phase 6 — Evolutions futures

- [ ] Rôles (owner / editor / viewer)
- [ ] MCP multi-user (remplacer `localUserId` unique)
- [ ] Notifications in-app quand on est ajouté à un projet
- [ ] Historique d'activité par projet (qui a modifié quoi)
