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

## Reste à faire

- **Pages individuelles** : chaque page (ProjectDetails, Dashboard, Eisenhower, Budget, etc.) n'est pas encore responsive. Les tables, formulaires et layouts internes débordent probablement.
- **ChatWidget** : vérifier z-index et comportement sur mobile (conflit potentiel avec le drawer à z-index 1000)
- **Touch interactions** : les drag-and-drop (favoris, tâches) ne marchent probablement pas bien sur mobile
- **Favorites bar** : tester le scroll horizontal sur vrais appareils
- **Tester light/dark** sur mobile
- **Tester focus mode** sur mobile
