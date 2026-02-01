# Feature : Claude Code intégré

Interface web pour interagir avec Claude Code (CLI) depuis Panorama. Chaque conversation est une **session** qui spawn un process `claude` côté serveur.

## Architecture

```text
UI (React)                    Server (Meteor)
─────────                     ───────────────
ClaudeCodePage                methods.js
├── ProjectList                 ├── claudeSessions.create
├── SessionView (×N)            ├── claudeSessions.createInProject
│   ├── CommandPopup            ├── claudeSessions.sendMessage → processManager.spawnClaudeProcess()
│   └── MessageBubble           ├── claudeSessions.stop → processManager.killProcess()
│   Props:                      ├── claudeSessions.respondToPermission → processManager.respondToPermission()
│   └── onNewSession(newId)     ├── claudeSessions.update
└── NotePanel                   ├── claudeSessions.remove
                                └── claudeSessions.clearMessages
```

## Collections

### `claudeSessions`

Une session = une conversation avec Claude Code.

| Champ | Type | Description |
|-------|------|-------------|
| `name` | String | Nom affiché |
| `cwd` | String | Working directory du process |
| `model` | String | Modèle Claude à utiliser |
| `permissionMode` | String | `plan`, `acceptEdits`, `dontAsk`, `bypassPermissions` |
| `appendSystemPrompt` | String | Prompt système additionnel |
| `claudeSessionId` | String | ID de session Claude (pour `--resume`) |
| `status` | String | `idle`, `running`, `error`, `interrupted` |
| `pid` | Number | PID du process OS (set au spawn, null quand idle) |
| `lastError` | String | Dernière erreur |
| `totalCostUsd` | Number | Coût cumulé |
| `totalDurationMs` | Number | Durée cumulée |

### `claudeMessages`

Messages d'une session (user + assistant + system/error).

| Champ | Type | Description |
|-------|------|-------------|
| `sessionId` | String | Réf vers la session |
| `role` | String | `user`, `assistant`, `system` |
| `type` | String | `assistant`, `result`, `error`, `permission_request` |
| `content` | Array | Blocs de contenu (text, tool_use, tool_result) |
| `contentText` | String | Texte brut extrait |
| `toolName` | String | Nom de l'outil (pour `permission_request`) |
| `toolInput` | Object | Input de l'outil (pour `permission_request`) |
| `isStreaming` | Boolean | Message en cours de streaming |
| `usage` | Object | `{input_tokens, output_tokens}` |
| `costUsd` | Number | Coût de ce message |
| `durationMs` | Number | Durée de ce message |

Index : `{ sessionId: 1, createdAt: 1 }`

## Process Manager (`processManager.js`)

- Spawn `claude --output-format stream-json --verbose --permission-prompt-tool stdio --input-format stream-json` avec les options de la session
- Le prompt est envoyé via stdin en format stream-json (pas via `-p`, cf. section Permission ci-dessous)
- Parse le flux JSON ligne par ligne (events `system/init`, `assistant`, `user`, `result`, `control_request`)
- Gère le resume via `--resume <claudeSessionId>`
- Kill avec SIGTERM puis SIGKILL après 5s
- Logs dans `~/.panorama-claude.log`

## Permission Requests (interactive via stdin)

### Pourquoi stdin en pipe

Le CLI Claude v2.x **bloque quand stdin est un pipe ouvert** : il attend un message JSON avant de démarrer. Avec `stdin: 'ignore'`, le CLI démarre immédiatement mais on ne peut pas lui envoyer de réponses de permission.

Solution : on utilise `stdio: ['pipe', 'pipe', 'pipe']` et on envoie le prompt via `proc.stdin.write()` en format stream-json au lieu de `-p`. Le flag `-p` ne fonctionne PAS quand stdin est un pipe.

### Protocole permission-prompt-tool

Le flag `--permission-prompt-tool stdio` (non documenté dans `--help` mais utilisé par les SDK Agent) active un protocole de contrôle sur stdin/stdout :

**1. Le CLI veut utiliser un outil protégé → envoie un `control_request` sur stdout :**

```json
{
  "type": "control_request",
  "request_id": "uuid-xxx",
  "request": {
    "subtype": "can_use_tool",
    "tool_name": "Edit",
    "input": { "file_path": "...", "old_string": "...", "new_string": "..." },
    "permission_suggestions": [
      { "type": "setMode", "mode": "acceptEdits", "destination": "session" }
    ],
    "tool_use_id": "toolu_xxx"
  }
}
```

**2. Le process manager stocke la requête et insère un message `permission_request` en DB.**

**3. L'UI affiche les boutons Allow / Allow All / Deny.**

**4. L'utilisateur clique → Meteor method `claudeSessions.respondToPermission` → écrit sur stdin :**

```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "uuid-xxx",
    "response": {
      "behavior": "allow",
      "updatedInput": { ... }
    }
  }
}
```

### Réponses possibles

| Bouton | `behavior` | Effet |
|--------|-----------|-------|
| **Allow** | `allow` + `updatedInput` (original) | Exécute l'outil une fois |
| **Allow All** | `allow` + `updatedInput` + `updatedPermissions: [{type: "setMode", mode: "acceptEdits", destination: "session"}]` | Exécute + passe en mode acceptEdits pour la suite |
| **Deny** | `deny` + `message: "User denied"` | Claude reçoit le refus et adapte son approche |

### Timeout

Le CLI attend 60 secondes. Si aucune réponse n'est envoyée, il traite comme un deny et essaie autrement.

### Cleanup

Les requêtes en attente (`pendingPermissions` Map) sont nettoyées sur `killProcess` et `exit`.

### Quand le `control_request` ne se déclenche PAS

Le CLI évalue les permissions dans cet ordre :

1. **Hooks**
2. **Permission rules** (deny → allow → ask dans `settings.json` / `settings.local.json`)
3. **Permission mode** (`acceptEdits`, `bypassPermissions`, etc.)
4. **`canUseTool` callback** (= notre `control_request` via stdin)

Si un outil est déjà autorisé à l'étape 2 (ex: `Bash(mongosh:*)`, `Read`, `Glob`, tous les MCP tools), le CLI l'exécute directement sans envoyer de `control_request`. Notre protocole stdin ne se déclenche que pour les outils **non couverts** par les rules, typiquement `Edit`, `Write`, ou des commandes Bash pas encore dans la whitelist.

Pour que le flow interactif couvre plus d'outils, il faudrait **retirer les rules `allow` correspondantes** des fichiers `~/.claude/settings.json` et `~/.claude/settings.local.json`, ou du `.claude/settings.local.json` du projet.

### Legacy fallback

L'ancien mécanisme (détection de `"requested permissions"` dans les events `type=user`) est conservé en fallback pour les cas où le protocole stdio ne s'applique pas.

## Process Identification

Les process Claude spawnés par Panorama reçoivent la variable d'environnement `PANORAMA_SESSION=<sessionId>`. Cela permet de les distinguer des process Claude lancés manuellement dans un terminal :

```bash
ps eww | grep PANORAMA_SESSION
```

Le PID est aussi stocké dans le champ `pid` de la session MongoDB, ce qui permet un cross-référencement DB ↔ OS.

## Interrupted Sessions (Server Restart)

Au redémarrage du serveur Meteor, les sessions `running` deviennent orphelines (le process OS est mort).

**Comportement au startup (`server/main.js`)** :
1. Recherche toutes les sessions `{ status: 'running' }`
2. Tente un `process.kill(session.pid)` best-effort pour nettoyer les zombies OS
3. Marque chaque session `status: 'interrupted'`, `pid: null`
4. Insère un message système "Session interrupted by a server restart." dans le chat

**Notification client (`App.jsx`)** :
1. Au mount, appelle `claudeSessions.countInterrupted`
2. Si > 0 : navigue vers la page Claude Code, affiche une modale non-dismissable
3. Le bouton "Proceed" appelle `claudeSessions.cleanupInterrupted` qui remet les sessions en `idle`

**Methods** :
- `claudeSessions.countInterrupted` — retourne le nombre de sessions `interrupted`
- `claudeSessions.cleanupInterrupted` — reset bulk `interrupted` → `idle`, `pid: null`

## Frozen Sessions (Error State)

Quand une session passe en `status: 'error'`, l'UI est **freezée** (lecture seule). L'utilisateur peut consulter les messages mais ne peut plus interagir avec le process.

### Comportement UI

- **Textarea** : `disabled`, placeholder "Session ended with error..."
- **handleSend** : guard `if (isFrozen) return` — aucun envoi possible
- **CommandPopup** : masquée (les slash commands sont inutiles)
- **Bouton Stop** : masqué (pas de process à arrêter)
- **Frozen banner** : remplace la barre d'erreur simple, affiche le `lastError` + bouton "New Session"
- **Ce qui reste fonctionnel** : scroll des messages, copier-coller, bouton Clear, bouton Settings, renommage de la session

### Bouton "New Session"

Crée une nouvelle session dans le même projet (`claudeSessions.createInProject`) et switch l'onglet actif via le callback `onNewSession` passé par `ClaudeCodePage`. L'ancienne session reste dans la liste des tabs, consultable.

### Pourquoi le process est déjà mort

Quand `status === 'error'`, le process OS est **toujours déjà terminé**. Trois chemins mènent à ce status, et dans chacun le process est mort ou sur le point de mourir :

1. **`result` avec `subtype: 'error'`** — Claude CLI a envoyé son résultat d'erreur sur stdout puis se termine. Le handler `proc.on('exit')` fait `activeProcesses.delete(sessionId)`.

2. **`proc.on('error')`** (erreur de spawn) — le process n'a jamais démarré ou a crashé immédiatement. `activeProcesses.delete(sessionId)` est fait dans le handler.

3. **`proc.on('exit')` avec code anormal** (code !== 0, signal !== SIGTERM) — on est *dans* le handler `exit`, le process est déjà mort. `activeProcesses.delete(sessionId)` est fait en premier.

Pas besoin de kill explicite. Le freeze est purement côté UI pour empêcher l'envoi de messages à un process qui n'existe plus.

### Cycle de vie complet

```text
running → [error result / spawn error / abnormal exit]
       → process meurt
       → activeProcesses.delete(sessionId)
       → status: 'error', lastError: "..."
       → UI freeze (textarea disabled, frozen banner)
       → User clique "New Session"
       → claudeSessions.createInProject(projectId)
       → nouvelle session idle, ancienne consultable
```

## Slash Commands

Commandes tapées dans le composer, interceptées côté client (jamais envoyées à Claude).

| Commande | Action |
|----------|--------|
| `/clear` | Vide les messages, reset la session |
| `/stop` | Arrête le process en cours |
| `/model <name>` | Change le modèle |
| `/cwd <path>` | Change le working directory |
| `/help` | Affiche les commandes (message local) |

Popup d'autocomplete : apparaît quand le texte commence par `/`, navigation clavier (↑↓ Enter Escape Tab).

## Fichiers

```
imports/api/claudeSessions/
  collections.js          # Collection Mongo
  methods.js              # Meteor methods (CRUD + sendMessage + stop)
  publications.js         # Publications reactives
  processManager.js       # Spawn/kill du process claude

imports/api/claudeMessages/
  collections.js          # Collection Mongo + index
  publications.js         # Publication par session

imports/ui/ClaudeCode/
  ClaudeCodePage.jsx      # Layout : ProjectList + SessionView(s) + NotePanel
  ProjectList.jsx         # Liste des projets et sessions, création
  SessionView.jsx         # Chat, composer, slash commands, frozen state
  CommandPopup.jsx        # Popup autocomplete des commandes
  MessageBubble.jsx       # Rendu d'un message (markdown, tool_use, tool_result)
  NotePanel.jsx           # Sidebar note liée au projet
```

## Route

`#/claude/:sessionId?` — accessible depuis la nav principale.

## TODO

- **ESC multi-session** : vérifier que le handler global ESC (ajouté sur `document.keydown`) ne stoppe pas toutes les sessions, seulement celle qui a le focus (`isActive`). Le guard `isActive` est en place mais à tester avec plusieurs sessions visibles.
- **Loading indicator intermittent** : le typing indicator (`ccTypingIndicator`) ne s'affiche pas toujours. Investiguer : race condition sur `session.status` (running → idle trop rapide avant que React re-render), ou status bloqué sur `running` après un hot-reload Meteor (process orphelin, Maps in-memory perdues).
- **Audit des permission rules** : les `allow` rules dans `~/.claude/settings.json`, `~/.claude/settings.local.json` et `.claude/settings.local.json` (projet) court-circuitent le protocole `control_request`. Faire une passe pour décider quels outils doivent passer par le flow interactif vs auto-approve.
- Couper l'écran en plusieurs sessions avec Cmd-D comme dans l'éditeur Warp
