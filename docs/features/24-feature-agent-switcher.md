# Feature: Agent Switcher & Reasoning Controls

## Vision

Permettre de **switcher l'agent actif** (Claude ou Codex) directement depuis la status bar d'une session Claude Code. L'utilisateur peut poser une question a Claude, puis cliquer sur "Codex" et faire repondre Codex sur la meme conversation, et vice-versa.

Ajouter egalement des **controles de reasoning/effort** par agent.

## Ce qu'on veut

### 1. Switcher d'agent dans la status bar

- Deux boutons toggle dans la status bar : **Claude** | **Codex**
- Quand on envoie un message, il part a l'agent selectionne
- Le badge model existant (lecture seule) reste pour verifier quel modele a reellement repondu
- Les reponses des deux agents s'affichent dans le meme fil de conversation

### 2. Choix du modele par agent

**Claude** : select avec les aliases disponibles
- `sonnet` (claude-sonnet-4-5)
- `opus` (claude-opus-4-6)
- `haiku` (claude-haiku-4-5)

**Codex** : select avec les modeles Codex
- `gpt-5.3-codex` (defaut, le plus capable)
- `gpt-5.2-codex` (precedent)
- `gpt-5.1-codex-mini` (economique)
- `gpt-5.1-codex-max` (taches longues)

### 3. Controles de reasoning/effort

**Claude** : thinking budget via env var `MAX_THINKING_TOKENS` au spawn
- Valeurs : `low` (8k), `medium` (16k), `high` (32k, defaut Claude), `max` (64k)
- Applique au prochain spawn (pas mid-session), coherent avec le modele

**Codex** : `model_reasoning_effort` via `-c`
- Valeurs : `minimal`, `low`, `medium`, `high`, `xhigh`
- `xhigh` depend du modele (pas dispo partout)
- Config actuelle : `medium` dans `~/.codex/config.toml`

## Architecture technique

### Etat actuel

- **Claude** tourne comme un process persistant (`claude -p --output-format stream-json --resume`)
  - Maintient le contexte de conversation complet
  - Supporte `--model` pour choisir le modele
  - Le champ `session.model` est passe au spawn
- **Codex** est utilise en one-shot via `codex exec --json --full-auto`
  - Chaque appel est independant, pas de memoire des messages precedents
  - Pas de `--model` passe actuellement (utilise le defaut de `~/.codex/config.toml`)
  - Utilise dans deux contextes : commande `/codex` et mode debate

### Contrainte principale : Codex n'a pas de mode conversationnel pilotable

Le CLI Codex a un mode interactif (TUI) mais il n'expose pas d'interface programmatique equivalente au `--output-format stream-json` de Claude. On ne peut pas le piloter comme un process persistant.

`codex exec` est one-shot avec `--json` (JSONL output).

### Approche retenue : one-shot enrichi (option A)

Quand l'agent actif est Codex :
1. On collecte l'historique de la conversation (messages Claude + Codex precedents)
2. On construit un prompt enrichi avec le contexte
3. On envoie via `codex exec --json --full-auto --model <model> -c model_reasoning_effort=<effort> -C <cwd>`
4. Le resultat s'affiche dans le chat comme un message Codex
5. Si le message suivant est aussi pour Codex, on reinjecte le contexte

**Trade-offs** :
- (+) Pragmatique, rapide a implementer
- (+) Codex est optimise pour des taches ponctuelles, pas de longues conversations
- (-) Chaque appel Codex repart de zero (pas de vrai suivi de conversation cote process)
- (-) Le contexte injecte dans le prompt consomme des tokens

**Alternative ecartee** : appeler directement l'API OpenAI Responses avec les modeles Codex pour maintenir l'historique nous-memes. Trop de boulot a ce stade, on pourra y revenir.

### Synchronisation du contexte entre agents

Quand on switch de Codex vers Claude, le process Claude ne connait pas l'echange Codex. Pour maintenir la coherence :
- **Apres chaque reponse Codex**, on injecte un **message systeme** dans la conversation Claude qui resume l'echange (question user + reponse Codex)
- Cela permet a Claude de savoir ce que Codex a dit quand l'utilisateur revient vers lui
- Le message systeme est visible dans le chat (type `codex_context` ou similaire)

### Changement de modele Claude

Le modele Claude est passe au spawn du process (`--model`). Changer le modele mid-session impliquerait de killer et relancer le process, ce qui est disruptif.

**Decision** : le changement de modele Claude s'applique a la **prochaine session** uniquement. Le select modele Claude met a jour `session.model` mais le process en cours continue avec le modele initial. Le badge model (lecture seule) confirme le modele actif reel.

## Modifications necessaires

### Backend (`imports/api/claudeSessions/`)

**processManager.js** :
- `execCodex()` : passer `--model` et `-c model_reasoning_effort=<value>` au spawn
- `runCodexTurn()` (debate) : idem
- Nouvelle fonction ou adaptation pour le mode "agent switcher" : construire le prompt enrichi avec l'historique avant d'appeler `codex exec`

**methods.js** :
- Ajouter les champs `codexModel`, `codexReasoningEffort`, `claudeEffort` a la session
- Methode `claudeSessions.update` : accepter ces nouveaux champs
- Methode `claudeSessions.sendCodexMessage` (ou adapter `sendCodex`) : envoyer un message a Codex avec contexte

### Frontend (`imports/ui/ClaudeCode/`)

**SessionView.jsx** - Status bar :
- Ajouter un selecteur d'agent actif : Claude | Codex
- Ajouter des selects pour model et effort (contextuels selon l'agent actif)
- Garder le badge model en lecture seule (verification/debug)
- Quand l'agent est Codex, le submit du textarea appelle la methode Codex au lieu de Claude

**SessionView.css** :
- Styles pour le switcher d'agent et les selects de config

**MessageBubble.jsx** :
- Differencier visuellement les messages Claude vs Codex (icone, couleur, badge)

### Schema session (champs a ajouter)

```javascript
{
  // Existants
  model: String,          // modele Claude
  permissionMode: String,

  // Nouveaux
  activeAgent: String,           // 'claude' | 'codex' (defaut: 'claude')
  codexModel: String,            // ex: 'gpt-5.3-codex'
  codexReasoningEffort: String,  // 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  claudeEffort: String,          // 'low' | 'medium' | 'high' | 'max'
}
```

## Roadmap

### Phase 1 : Fondations backend

Poser les bases dans le schema et le processManager pour que Codex puisse recevoir un modele et un reasoning effort, et que Claude puisse recevoir un effort level.

### Phase 2 : Agent switcher UI

Ajouter le selecteur d'agent dans la status bar et router les messages vers le bon agent. C'est le coeur de la feature.

### Phase 3 : Controles model/effort dans la status bar

Ajouter les selects contextuels (modele + effort) qui changent selon l'agent actif. L'utilisateur voit et controle les parametres de l'agent selectionne.

### Phase 4 : Contexte conversationnel pour Codex

Construire le prompt enrichi qui injecte l'historique de la conversation quand on envoie un message a Codex, pour qu'il ait le contexte des echanges precedents.

### Phase 5 : Polish

Differenciation visuelle des messages par agent, persistence des preferences, edge cases.

---

## TODO

### Phase 1 — Backend ✓

- [x] Ajouter les champs `activeAgent`, `codexModel`, `codexReasoningEffort`, `claudeEffort` au schema session
- [x] Mettre a jour `claudeSessions.update` pour accepter ces champs
- [x] Passer `--model` et `-c model_reasoning_effort=<value>` dans `execCodex()`
- [x] Passer `--model` et `-c model_reasoning_effort=<value>` dans `runCodexTurn()` (debate)
- [x] Implementer le passage de l'effort level a Claude via `MAX_THINKING_TOKENS` env var au spawn (low=8k, medium=16k, high=32k, max=64k)
- [x] Apres chaque reponse Codex, injecter un message systeme `codex_context` dans la conversation Claude (resume de l'echange)

### Phase 2 — Agent switcher ✓

- [x] Ajouter le toggle Claude | Codex (deux boutons) dans la status bar (`SessionView.jsx`)
- [x] Persister `activeAgent` dans la session via `claudeSessions.update`
- [x] Router le submit du textarea : si agent=claude, envoyer a Claude ; si agent=codex, appeler `execCodex`
- [x] Reutilise la methode `claudeSessions.execCodex` existante (pas besoin d'une nouvelle methode)
- [x] Bloquer le toggle pendant qu'un agent repond (`isBusy = isRunning || isCodexRunning || isDebateRunning`)
- [x] Placeholder du textarea contextuel selon l'agent actif
- [x] Styles CSS : toggle avec couleur Claude (primary) vs Codex (success/green)

### Phase 3 — Controles model/effort ✓

- [x] Ajouter un select modele Codex dans la status bar (visible quand agent=codex)
- [x] Ajouter un select effort/reasoning dans la status bar (contextuel : Claude effort vs Codex reasoning)
- [x] Permission mode visible uniquement quand agent=claude (non pertinent pour Codex)
- [x] Mettre a jour la session a chaque changement de select
- [x] Styles CSS pour les nouveaux selects (meme pattern que permissionMode)

### Phase 4 — Contexte conversationnel Codex ✓

- [x] Construction du prompt enrichi dans `claudeSessions.execCodex` quand `options.conversational=true`
- [x] Collecte des 20 derniers messages (user + assistant), excluant shell/codex commands
- [x] Chaque message tronque a 500 chars, format `[User/Claude/Codex]: text`
- [x] Distinction entre `/codex` (one-shot, pas de contexte) et message via switcher (conversationnel)
- [x] Le message user s'affiche comme type `user` (pas `codex_command`) en mode conversationnel

### Phase 5 — Polish (partiel)

- [x] Badge "Codex" vert sur chaque message `codex_result` dans `MessageBubble.jsx`
- [x] Messages Codex avec bordure verte (coherent avec le style debate)
- [x] Messages `codex_context` (resume injecte) discrets (opacity, italic, petite taille)
- [ ] Afficher le modele utilise sur chaque reponse (deja partiellement fait avec `model` sur les messages)
- [ ] Persister les preferences model/effort au niveau projet (herite par les nouvelles sessions)
- [ ] Changement de modele Claude : appliquer a la prochaine session, pas a la session en cours
- [ ] Gerer le cas "codex CLI non installe" : griser l'option Codex dans le switcher
- [ ] Tester le flow complet : Claude → switch Codex → reponse → switch Claude → reponse avec contexte

---

## Liens et references

- [Codex CLI models](https://developers.openai.com/codex/models/)
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference/)
- [Codex config reference](https://developers.openai.com/codex/config-reference/)
- [Claude adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- Config Codex locale : `~/.codex/config.toml`
