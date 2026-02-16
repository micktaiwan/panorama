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
| `noteLines` | `noteLines` | Via sessionId → besoin de résoudre les sessions accessibles |
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

## 6. Invitation par email

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
}
```

### UI

Dans les settings du projet, ajouter une section "Members" :

- Champ input email + bouton "Add"
- Liste des membres actuels avec bouton "Remove" (sauf le owner)
- Feedback immédiat : "User not found" si l'email n'existe pas en base

---

## 7. Qdrant / Recherche sémantique

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

## 8. Sécurité — points d'attention

- **Pas de fuite d'information** : les erreurs restent `'not-found'` (pas `'not-authorized'`)
- **Owner seul** peut : supprimer le projet, ajouter/retirer des membres
- **Membres** peuvent : lire et modifier tous les docs du projet (tasks, notes, etc.)
- **Docs orphelins** : accessibles uniquement par leur `userId` (créateur)
- **Cascade suppression** : quand le owner supprime un projet, tous les docs enfants sont supprimés — y compris ceux créés par d'autres membres

---

## 9. Ordre d'implémentation

1. **Migration schema** : ajouter `memberIds` aux projets existants, index MongoDB
2. **Auth helper** : `ensureProjectAccess`
3. **Methods projets** : `projects.insert` (init `memberIds`), `projects.addMember`, `projects.removeMember`
4. **Publications** : modifier pour utiliser `$or` avec les projectIds accessibles
5. **Methods enfants** : adapter tasks, notes, noteSessions, noteLines, links, files pour utiliser `ensureProjectAccess`
6. **Tasks `assigneeId`** : migration + méthode `tasks.assign`
7. **UI Members** : section dans les settings du projet
8. **UI Tasks** : sélecteur d'assignation (dropdown des membres du projet)
9. **Qdrant** : adapter payloads et filtres, rebuild
10. **Tests**

---

## 10. Risques et compromis

| Risque | Mitigation |
|---|---|
| Performance des publications avec `$or` + `$in` | Index `memberIds` + `projectId` sur chaque collection |
| Cascade delete supprime les docs d'autres users | Acceptable : le owner a le contrôle, c'est documenté |
| Pas de rôles → un membre peut tout modifier | OK pour l'usage actuel (confiance entre membres), évolutif plus tard |
| MCP `localUserId` ne voit pas les projets partagés | Différé — à traiter quand le MCP sera multi-user |
| Qdrant rebuild nécessaire | One-shot, déjà un mécanisme en place |
