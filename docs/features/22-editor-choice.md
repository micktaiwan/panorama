# Choix de l'éditeur de notes : ProseMirror

## Contexte

L'éditeur de notes était un `<textarea>` brut avec preview Markdown en split view. Le besoin : un éditeur WYSIWYG puissant permettant des actions sur une sélection (formatting, AI), des actions par ligne (transformer en tâche), et une extensibilité totale.

Critères : gratuit (MIT), le plus puissant possible, la courbe d'apprentissage n'est pas un critère (Claude code).

## Alternatives évaluées

### TipTap — rejeté

Wrapper React/Vue autour de ProseMirror. 34.8k stars, MIT (core).

**Rejeté parce que** : stack d'abstraction trop profond (6 couches : code utilisateur → TipTap React → TipTap Extension → ProseMirror Plugin → ProseMirror Core → DOM). Quand on a besoin de personnalisation profonde, on finit par contourner TipTap pour accéder directement à ProseMirror. Certaines extensions sont payantes (pro), créant une dépendance commerciale.

### Lexical (Meta) — rejeté

20.6k stars, MIT, architecture moderne basée sur les noeuds.

**Rejeté parce que** : performance catastrophique sur les grands documents (minutes pour coller du texte, 1s de latence par caractère). Boilerplate excessif. Pré-1.0, API instable avec breaking changes fréquents. Pas de BubbleMenu/FloatingMenu natif.

### Slate.js — rejeté

30.3k stars, MIT, architecture flexible.

**Rejeté parce que** : beta perpétuel, jamais sorti en version stable. Problèmes Android/CJK majeurs et non résolus. Pas d'entreprise derrière pour garantir la maintenance.

### BlockNote — rejeté

Editeur "Notion-like" prêt à l'emploi, basé sur TipTap/ProseMirror.

**Rejeté parce que** : licence MPL-2.0 / GPL-3.0 (pas MIT). Paradigme bloc trop opinioné. Bundle lourd (~788 kB à cause de Shiki embarqué).

### Plate — rejeté

Ecosystème de plugins basé sur Slate.

**Rejeté parce que** : hérite de la complexité de Slate + sa propre couche d'abstraction. Dépendance à ShadCN/Tailwind que Panorama n'utilise pas.

## Pourquoi ProseMirror

**Contrôle total** : aucune couche d'abstraction, le code interagit directement avec le moteur d'édition. Architecture modulaire (prosemirror-model, prosemirror-state, prosemirror-view, prosemirror-transform).

**Performance éprouvée** : gère les grands documents sans latence. Utilisé en production par Atlassian (Confluence, Jira), le New York Times, The Guardian.

**API stable** : projet mature, pas de breaking changes. Licence MIT.

**Package prosemirror-markdown** : sérialisation markdown bidirectionnelle existante.

**Contexte Claude** : Claude lit directement les sources ProseMirror si la doc ne suffit pas. L'absence d'indirection simplifie le debug.

## Décisions architecturales

1. **ProseMirror comme dépendance npm, pas comme fork** — évite le fardeau de maintenance d'un fork
2. **Wrapper React custom** — un composant `ProseMirrorEditor` spécifique à Panorama, pas de wrapper générique
3. **Stockage en markdown** — le contenu reste une string markdown dans MongoDB, backward compatible
4. **BubbleMenu et SlashMenu custom** — plugins ProseMirror maison, contrôle total sur le comportement
5. **softbreak → hard_break** — markdown-it (commonmark) traite les `\n` simples comme des softbreaks (espaces). Les notes Panorama utilisent `\n` pour les retours à la ligne visibles. Le parser map `softbreak` vers `hard_break` pour préserver les retours à la ligne. Le serializer émet `\n` (pas `\\\n`) pour un round-trip fidèle.

## Structure des fichiers

```
imports/ui/Notes/
├── prosemirror/
│   ├── schema.js        # Nodes (doc, paragraph, heading, lists, code_block, etc.) + Marks (strong, em, code, link)
│   ├── markdownIO.js    # parseMarkdown(string) → Doc, serializeMarkdown(doc) → string
│   ├── keymap.js        # Cmd+S (save), Cmd+W (close), Cmd+B/I/E/K (formatting), Tab (indent)
│   ├── inputRules.js    # Auto-formatting : # heading, - bullet, 1. ordered, ``` code, > quote, --- hr
│   ├── plugins.js       # Assemble tous les plugins dans l'ordre
│   ├── bubbleMenu.js    # Toolbar flottante sur sélection (Bold, Italic, Code, Link)
│   └── slashMenu.js     # Commandes / (h1, h2, h3, bullet, list, code, quote, hr)
└── components/
    └── ProseMirrorEditor/
        ├── ProseMirrorEditor.jsx  # Composant React : mount/destroy ProseMirror, debounce onChange
        └── ProseMirrorEditor.css  # Dark theme, styling pour tous les node types
```

## Compromis acceptés

| Aspect | Compromis |
|--------|-----------|
| Effort initial | Plus élevé qu'avec TipTap (pas de composants prêts à l'emploi) |
| BubbleMenu/SlashMenu | Construits from scratch |
| Documentation | Moins "friendly" que TipTap, mais Claude lit les sources |
| Maintenance | Couche d'intégration React custom à maintenir |
| Bundle | ~200 kB non minifié pour le core, plus léger que les alternatives |
