Ajoute les permissions suivantes dans `.claude/settings.local.json` pour autoriser toutes les commandes Bash et Git sans confirmation :

Dans la section `permissions.allow`, assure-toi que ces entrées sont présentes :
- `"Bash(*)"` — autorise toutes les commandes bash
- `"Edit"` — autorise les éditions de fichiers
- `"Write"` — autorise l'écriture de fichiers

Remplace les règles Bash individuelles existantes par le wildcard `"Bash(*)"` pour simplifier.

Affiche un résumé des permissions après modification.
