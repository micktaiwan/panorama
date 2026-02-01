# Feature : Claude Code intégré

Interface web pour interagir avec Claude Code (CLI) depuis Panorama. Chaque conversation est une **session** qui spawn un process `claude` côté serveur.

## Architecture

```text
UI (React)                    Server (Meteor)
─────────                     ───────────────
ClaudeCodePage                methods.js
├── SessionList                 ├── claudeSessions.create
└── SessionView                 ├── claudeSessions.sendMessage → processManager.spawnClaudeProcess()
    ├── CommandPopup            ├── claudeSessions.stop → processManager.killProcess()
    └── MessageBubble           ├── claudeSessions.respondToPermission → processManager.respondToPermission()
                                ├── claudeSessions.update
                                ├── claudeSessions.remove
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
| `status` | String | `idle`, `running`, `error` |
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
  ClaudeCodePage.jsx      # Layout : SessionList + SessionView
  SessionList.jsx         # Liste des sessions, création, suppression
  SessionView.jsx         # Chat, composer, slash commands
  CommandPopup.jsx        # Popup autocomplete des commandes
  MessageBubble.jsx       # Rendu d'un message (markdown, tool_use, tool_result)
```

## Route

`#/claude/:sessionId?` — accessible depuis la nav principale.

## TODO

- **ESC multi-session** : vérifier que le handler global ESC (ajouté sur `document.keydown`) ne stoppe pas toutes les sessions, seulement celle qui a le focus (`isActive`). Le guard `isActive` est en place mais à tester avec plusieurs sessions visibles.
- **Loading indicator intermittent** : le typing indicator (`ccTypingIndicator`) ne s'affiche pas toujours. Investiguer : race condition sur `session.status` (running → idle trop rapide avant que React re-render), ou status bloqué sur `running` après un hot-reload Meteor (process orphelin, Maps in-memory perdues).
- **Audit des permission rules** : les `allow` rules dans `~/.claude/settings.json`, `~/.claude/settings.local.json` et `.claude/settings.local.json` (projet) court-circuitent le protocole `control_request`. Faire une passe pour décider quels outils doivent passer par le flow interactif vs auto-approve.
- Couper l'écran en plusieurs sessions avec Cmd-D comme dans l'éditeur Warp
