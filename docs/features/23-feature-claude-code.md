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
    └── MessageBubble           ├── claudeSessions.update
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
| `permissionMode` | String | `plan`, `autoEdit`, `fullAuto` |
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
| `content` | Array | Blocs de contenu (text, tool_use, tool_result) |
| `contentText` | String | Texte brut extrait |
| `isStreaming` | Boolean | Message en cours de streaming |
| `usage` | Object | `{input_tokens, output_tokens}` |
| `costUsd` | Number | Coût de ce message |
| `durationMs` | Number | Durée de ce message |

Index : `{ sessionId: 1, createdAt: 1 }`

## Process Manager (`processManager.js`)

- Spawn `claude -p <message> --output-format stream-json --verbose` avec les options de la session
- Parse le flux JSON ligne par ligne (events `system/init`, `assistant`, `result`)
- Gère le resume via `--resume <claudeSessionId>`
- Kill avec SIGTERM puis SIGKILL après 5s
- Logs dans `~/.panorama-claude.log`

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

TODO

- pouvoir renommer la session en cliquant sur le nom de la session dans le header qui indique nom + path + idle
- augmenter l'espace pour l'affchage du path (là il y a des ellipses qui coupent le path)
- couper l'écran en plusieurs sesions avec Cmd-D comme dans l'éditeur Warp
- dans la liste des sessions, raccourcir le path de /users/mickaelfm/... en ~/projects/....
