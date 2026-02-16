# Mobile Responsive

## Objectif

Rendre le **shell** de Panorama (container, header, navigation, footer, panels) utilisable sur mobile sans toucher aux pages individuelles. Approche : desktop inchangé, adaptations via `@media (max-width: 768px)`.

## Fait

- **Container full-width** : suppression du toggle width (1100px / 90% / 100%), container permanent à `max-width: 100%`
- **Container et panels responsive** : padding réduit sur mobile (12px)
- **Overflow-x hidden** sur html/body/container/panel pour empêcher le débordement horizontal
- **Header mobile** : taille réduite, bloc user (email + logout) caché
- **Menu hamburger** : bouton visible uniquement sur mobile (à droite du header), ouvre un drawer pleine largeur avec toute la navigation + actions + logout
- **Footer caché** sur mobile (navigation via hamburger)
- **Favorites bar** : scroll horizontal au lieu de wrap

## Fichiers modifiés

| Fichier | Changement |
|---------|------------|
| `client/main.css` | Container full-width, suppression `.w90`/`.full`, media queries mobile |
| `imports/ui/App.jsx` | Suppression width toggle, intégration HamburgerMenu |
| `imports/ui/App.css` | Media queries header/footer/favorites bar |
| `imports/ui/components/HamburgerMenu/HamburgerMenu.jsx` | Nouveau composant |
| `imports/ui/components/HamburgerMenu/HamburgerMenu.css` | Styles drawer + responsive |

## Notes page (fait)

Layout deux colonnes (sidebar 300px + editor) remplacé par vue unique avec toggle sur mobile :

- **CSS class conditionnelle** `.mobile-editor-active` sur `.notes-page` quand `activeTabId` est set
- **Bouton ←** dans la barre de tabs pour revenir à la liste (visible uniquement mobile)
- **CSS-only visibility toggle** via `display: none` dans media query — pas de mount/unmount React
- **Flex layout dynamique** : `.container:has(.notes-page)` en flex column `height: 100dvh`, le `.panel` prend `flex: 1`, `.notes-page` remplit le panel. Zéro magic number.
- **Actions bar compact** : padding réduit, métadonnées dates cachées, boutons compacts
- **Touch targets** : items de liste plus grands (16px padding), bouton delete toujours visible (pas hover-only)
- **ProseMirror** : padding réduit (12px)
- **AskAI sidebar** : fullscreen overlay (`position: fixed; inset: 0`)

### Fichiers modifiés (notes)

| Fichier | Changement |
|---------|------------|
| `imports/ui/Notes/NotesPage.jsx` | Classe `.mobile-editor-active`, callback `handleBackToList`, prop `onBackToList` |
| `imports/ui/Notes/NotesPage.css` | Media query : flex layout container/panel/notes-page, toggle sidebar/editor |
| `imports/ui/Notes/components/NotesTabs.jsx` | Bouton ← retour, prop `onBackToList` |
| `imports/ui/Notes/components/NotesTabs.css` | Styles bouton retour, tabs compacts sur mobile |
| `imports/ui/Notes/components/NoteEditor.css` | Actions bar compact, métadonnées cachées |
| `imports/ui/Notes/components/NotesList.css` | Touch targets, delete visible |
| `imports/ui/Notes/components/ProseMirrorEditor/ProseMirrorEditor.css` | Padding réduit |
| `imports/ui/Notes/components/AskAiSidebar/AskAiSidebar.css` | Fullscreen overlay |

## Plan : intégration hamburger menu par page

### Principe

Sur mobile, le header Panorama, la favorites bar et le footer sont cachés (`display: none`). Le bouton `≡` du menu hamburger doit être intégré **à l'intérieur d'un élément UI existant** de chaque page (toolbar, titre, header de section) pour ne consommer **zéro pixel vertical supplémentaire**. Pas de ligne vide, pas de barre dédiée au-dessus du contenu.

Référence : sur la page Notes, le `≡` est intégré dans la barre de tabs — il partage l'espace avec les onglets.

### Mécanisme

- **Custom event** `'open-hamburger-menu'` : n'importe quel bouton peut l'émettre via `window.dispatchEvent(new CustomEvent('open-hamburger-menu'))`
- **HamburgerMenu standalone** (dans App.jsx, hors du `.appHeader`) : écoute l'event, rend uniquement le backdrop + drawer (pas de bouton). Toujours monté, jamais dans un parent `display: none`.
- **Bouton `≡` par page** : chaque page ajoute un `<button>` dans son UI existante, visible uniquement sur mobile via la classe `.mobile-menu-btn` (`display: none` desktop, `display: flex` mobile).

### Pages à modifier

| Page | Composant | Point d'insertion du `≡` |
|------|-----------|--------------------------|
| Notes | `NotesTabs` / `NotesSearch` | Dans la barre de tabs (fait) / à côté du champ recherche (vue liste) |
| Home | `App.jsx` (homeToolbar) | À côté du bouton "New Project" |
| Project | `ProjectDetails` | Dans le header du projet (à côté du titre) |
| Dashboard | `Dashboard` | Dans le toolbar/header |
| Emails | `EmailsPage` | Dans la barre de recherche/filtres |
| Calendar | `CalendarPage` | Dans le toolbar mois/semaine |
| Budget | `BudgetPage` | Dans le header/toolbar |
| Eisenhower | `EisenhowerPage` | Dans le header |
| People | `PeoplePage` | Dans le toolbar |
| Files | `FilesPage` | Dans le toolbar |
| Links | `LinksPage` | Dans le toolbar |
| Alarms | `AlarmsPage` | Dans le header |
| Preferences | `PreferencesPage` | Dans le header |
| Help | `HelpPage` | Dans le header |
| Session | `NoteSession` | Dans le header de session |
| UserLog | `UserLogPage` | Dans le toolbar |
| Web Search | `WebPage` | Dans la barre de recherche |
| Claude Code | `ClaudeCodePage` | Dans le header |
| Reporting | `ReportingPage` | Dans le toolbar |
| Situation Analyzer | `SituationAnalyzerPage` | Dans le toolbar |
| Notion | `NotionReportingPage` | Dans le header |
| Admin | `AdminPage` | Dans le header |
| Import Tasks | `ImportTasksPage` | Dans le header |

### CSS partagé

```css
/* Classe réutilisable pour le bouton menu par page */
.mobile-menu-btn {
  display: none;
  /* Styles identiques à .notes-back-button */
}

@media (max-width: 768px) {
  .mobile-menu-btn { display: flex; }
}
```

### Ordre d'implémentation suggéré

1. Mettre en place le mécanisme (standalone HamburgerMenu + custom event + classe CSS partagée)
2. Pages les plus utilisées : Home, Project, Dashboard, Emails, Calendar
3. Pages secondaires : Budget, Eisenhower, People, Files, Links, Alarms
4. Pages tertiaires : Preferences, Help, Reporting, Web Search, Claude Code, Notion, Admin, etc.

## Reste à faire (autres)

- **Pages individuelles** : chaque page (ProjectDetails, Dashboard, Eisenhower, Budget, etc.) n'est pas encore responsive. Les tables, formulaires et layouts internes débordent probablement.
- **ChatWidget** : vérifier z-index et comportement sur mobile (conflit potentiel avec le drawer à z-index 1000)
- **Touch interactions** : les drag-and-drop (favoris, tâches) ne marchent probablement pas bien sur mobile
- **Tester light/dark** sur mobile
- **Tester focus mode** sur mobile
