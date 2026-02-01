# Feature : Slack Save to Panorama

Sauvegarder un message Slack dans Panorama en un clic, avec enrichissement automatique par LLM (résumé, next steps, association au projet).

## Besoin

- Depuis Slack, sauvegarder un message important dans Panorama sous forme de note.
- Déterminer automatiquement le projet pertinent (recherche sémantique sur le contenu du message).
- Enrichir la note via LLM : résumé, sujet, auteur, date, next steps.
- Conserver le message original brut dans la note.
- Fonctionner en local sans exposer de port (Socket Mode).

Non-goals (MVP) :

- Sauvegarde automatique par règles (channels, patterns).
- Sauvegarde de threads entiers (un seul message dans le MVP).
- Création automatique de tâches à partir des next steps.

## Architecture

```text
Slack (message shortcut "Save to Panorama")
  │
  │  WebSocket sortant (Socket Mode)
  ▼
Bolt receiver (dans le process Meteor, server/slack/bot.js)
  │
  ├─ 1. Récupère le message complet (texte, auteur, channel, permalink)
  │
  ├─ 2. Recherche sémantique Panorama (vectorStore.js)
  │     → Trouve le projet le plus pertinent + notes liées
  │
  ├─ 3. Ouvre une modale Slack (Block Kit)
  │     → Projet pré-sélectionné, message affiché, bouton confirmer
  │
  ├─ 4. À la soumission :
  │     a) Appelle le LLM (llmProxy.chatComplete) avec message + contexte projet
  │        → Génère : résumé, sujet, next steps
  │     b) Crée la note enrichie (NotesCollection.insertAsync)
  │     c) Indexe dans Qdrant (upsertDoc)
  │
  └─ 5. Confirme dans Slack (ephemeral message)
```

### Pourquoi Socket Mode

Slack Socket Mode permet à l'app d'ouvrir une **connexion WebSocket sortante** vers Slack. Aucun port à exposer, aucun tunnel (ngrok, etc.) nécessaire. Parfait pour une app local-first.

```text
Panorama (Mac local)
  ──── WebSocket sortant ────→ Slack API
  ←─── événements reçus ──────
```

Bolt for JS supporte Socket Mode nativement via `@slack/bolt` + `@slack/socket-mode`.

## Slack App Configuration

### Scopes OAuth requises (Bot Token)

- `commands` — pour enregistrer le message shortcut
- `chat:write` — pour envoyer la confirmation éphémère
- `users:read` — pour résoudre le nom de l'auteur du message

### Manifest (extrait)

```yaml
features:
  shortcuts:
    - name: Save to Panorama
      type: message
      callback_id: save_to_panorama
      description: Save this message as a note in Panorama

settings:
  socket_mode_enabled: true
  interactivity:
    is_enabled: true
```

### Tokens et secrets

Stockés dans App Preferences (Panorama UI) ou en variables d'environnement :

| Secret | Env var | Description |
|--------|---------|-------------|
| Bot Token | `SLACK_BOT_TOKEN` | `xoxb-...` token OAuth du bot |
| App Token | `SLACK_APP_TOKEN` | `xapp-...` token pour Socket Mode |

### Visibilité

Le message shortcut apparaît pour tous les utilisateurs du workspace. Le handler Bolt vérifie `user_id` et ignore les requêtes d'autres utilisateurs. Configurable via App Preferences (`slackAllowedUserId`).

## Modale Slack (Block Kit)

Ouverte à la réception du message shortcut, après la recherche sémantique.

```
┌──────────────────────────────────────┐
│  Save to Panorama                    │
│                                      │
│  Projet:  [Projet Alpha ▾]          │  ← dropdown, pré-sélectionné
│                                      │
│  Message:                            │
│  ┌────────────────────────────────┐  │
│  │ On devrait migrer le service   │  │  ← lecture seule
│  │ auth vers OAuth2 avant la V3   │  │
│  └────────────────────────────────┘  │
│  De: @john · #engineering            │
│  31 jan 2026 · 14:32                 │
│                                      │
│           [Annuler]  [Sauvegarder]   │
└──────────────────────────────────────┘
```

Le dropdown "Projet" est peuplé dynamiquement via `ProjectsCollection.find()`. Le premier choix est le projet identifié par la recherche sémantique.

## Note générée

Format de la note créée dans Panorama :

```markdown
## Résumé

Migration du service auth vers OAuth2 proposée par John avant la V3.
Motivation : simplifier l'intégration SSO et réduire la dette technique.

## Next Steps

- [ ] Évaluer l'effort de migration OAuth2
- [ ] Identifier les endpoints impactés
- [ ] Planifier un spike technique

## Message original

**De** : @john · **Channel** : #engineering · **Date** : 31 jan 2026 14:32
[Voir sur Slack](https://workspace.slack.com/archives/C123/p456)

> On devrait migrer le service auth vers OAuth2 avant la V3.
> Ça simplifierait l'intégration SSO et on pourrait enfin
> se débarrasser du custom token system.
```

### Titre de la note

Généré par le LLM. Format : `[Slack] <sujet détecté>`.
Exemple : `[Slack] Proposition migration OAuth2`.

### Prompt LLM

```
Tu es un assistant qui analyse des messages Slack pour en extraire
l'essentiel. À partir du message ci-dessous et du contexte projet,
génère en français :

1. Un titre court et descriptif (sans préfixe [Slack], il sera ajouté)
2. Un résumé de 2-3 phrases
3. Une liste de 2-5 next steps actionnables (format checklist markdown)

Message :
{messageText}

Auteur : {authorName}
Channel : {channelName}
Contexte projet : {projectName} — {projectDescription}
```

## Fichiers

```
server/slack/
  bot.js              # Init Bolt (Socket Mode), handlers shortcut + modal
  slackHelpers.js     # Résolution user, construction modale, formatting

imports/api/appPreferences/
  (existant)          # Ajouter les clés : slackBotToken, slackAppToken,
                      #   slackAllowedUserId, slackEnabled
```

### bot.js — structure

```javascript
import { App } from '@slack/bolt';

// Init uniquement si les tokens sont configurés
const slackConfig = getSlackConfig();
if (!slackConfig.enabled) return;

const app = new App({
  token: slackConfig.botToken,
  appToken: slackConfig.appToken,
  socketMode: true,
});

// Message shortcut handler
app.shortcut('save_to_panorama', async ({ shortcut, ack, client }) => {
  await ack();

  // Vérifier user autorisé
  if (shortcut.user.id !== slackConfig.allowedUserId) return;

  const message = shortcut.message;

  // Recherche sémantique pour pré-sélectionner le projet
  const results = await semanticSearch(message.text);
  const suggestedProjectId = results[0]?.projectId;

  // Ouvrir la modale
  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: buildSaveModal({ message, suggestedProjectId }),
  });
});

// Modal submission handler
app.view('save_to_panorama_submit', async ({ ack, view, client }) => {
  await ack();

  const projectId = view.state.values.project.project_select.selected_option.value;
  const message = JSON.parse(view.private_metadata);

  // Enrichissement LLM
  const enriched = await enrichMessageWithLLM(message, projectId);

  // Créer la note
  const noteId = await NotesCollection.insertAsync({
    projectId,
    title: `[Slack] ${enriched.title}`,
    content: enriched.content,
    createdAt: new Date(),
  });

  // Indexer dans Qdrant
  await upsertDoc('note', noteId, `${enriched.title} ${enriched.content}`, projectId);

  // Confirmer dans Slack
  await client.chat.postEphemeral({
    channel: message.channel,
    user: message.userId,
    text: `Saved to project "${projectName}" in Panorama.`,
  });
});

await app.start();
```

## Configuration (App Preferences)

Nouvelles clés dans la section Preferences de Panorama :

| Clé | Type | Default | Description |
|-----|------|---------|-------------|
| `slackEnabled` | Boolean | `false` | Active/désactive l'intégration Slack |
| `slackBotToken` | String | `''` | Bot User OAuth Token (`xoxb-...`) |
| `slackAppToken` | String | `''` | App-Level Token pour Socket Mode (`xapp-...`) |
| `slackAllowedUserId` | String | `''` | Slack user ID autorisé (les autres sont ignorés) |

Le bot démarre au boot de Meteor si `slackEnabled === true` et les tokens sont renseignés. Il se reconnecte automatiquement (Bolt gère le retry).

## Dépendances npm

```
@slack/bolt       # Framework Slack (inclut socket-mode)
```

`@slack/bolt` inclut `@slack/socket-mode` et `@slack/web-api` en dépendances transitives.

## Roadmap

MVP

- [ ] Créer le Slack App (manifest, scopes, Socket Mode activé)
- [ ] Installer `@slack/bolt`
- [ ] Ajouter les clés Slack dans App Preferences (UI + config.js)
- [ ] `server/slack/bot.js` : init Bolt en Socket Mode, conditionnel sur config
- [ ] Handler message shortcut `save_to_panorama` avec vérification user
- [ ] Recherche sémantique sur le contenu du message pour pré-sélectionner le projet
- [ ] Construction et ouverture de la modale Slack (Block Kit)
- [ ] Handler de soumission modale : créer la note brute (sans LLM)
- [ ] Confirmation éphémère dans Slack après sauvegarde
- [ ] Intégration dans `server/main.js` (import conditionnel)

Enrichissement LLM (Phase 2)

- [ ] Prompt LLM pour générer titre, résumé, next steps
- [ ] Appel `chatComplete()` via `llmProxy.js` à la soumission
- [ ] Formatage markdown de la note enrichie (résumé + next steps + message original)
- [ ] Indexation Qdrant de la note (`upsertDoc`)

Polish (Phase 3)

- [ ] Sauvegarde de threads entiers (option dans la modale)
- [ ] Résolution du nom d'auteur via `users:read` (au lieu de l'ID)
- [ ] Gestion des attachments Slack (images, fichiers) : mention dans la note
- [ ] Déduplication : ignorer si même `channel + ts` déjà sauvegardé
- [ ] Indicateur dans l'UI Panorama : badge "Slack" sur les notes importées
- [ ] MCP tool `tool_slackStatus` pour vérifier l'état de la connexion Slack
- [ ] Création automatique de tâches Panorama à partir des next steps LLM

## Gotchas

- **Socket Mode tokens** : le App Token (`xapp-`) est distinct du Bot Token (`xoxb-`). Les deux sont nécessaires.
- **`trigger_id` expiration** : le `trigger_id` pour ouvrir une modale expire après **3 secondes**. La recherche sémantique doit être rapide ou faite après l'ouverture de la modale.
- **Message text** : les messages Slack utilisent le format mrkdwn (pas markdown standard). Convertir `<@U123>` en noms, `<url|label>` en liens markdown.
- **Rate limits Slack** : `chat.postEphemeral` est rate-limité. Pour un usage single-user, pas de souci.
- **Reconnexion** : Bolt Socket Mode gère le retry automatique, mais si le process Meteor redémarre, le bot redémarre avec.
