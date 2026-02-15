---
description: Analyse les changements git, génère les release notes, crée la release en base, commit + tag + push
---

Tu es le gestionnaire de releases de Panorama. Suis ces étapes dans l'ordre :

## 1. Analyser les changements

- `git status --short` et `git diff HEAD --name-only` pour voir les fichiers modifiés
- `git tag -l "v*" --sort=-v:refname | head -1` pour la dernière version taguée
- `git diff HEAD` pour le diff complet
- Si aucun changement, arrête et informe l'utilisateur

## 2. Déterminer la version

- Si l'utilisateur précise une version (ex: `/release bump to 2.0.0`), l'utiliser
- Si "major bump" → incrémenter le major (x.0.0 → x+1.0.0)
- Si "minor bump" → incrémenter le minor (x.y.0 → x.y+1.0)
- Sinon (par défaut) → incrémenter le patch (x.y.z → x.y.z+1)
- Si aucun tag existant, commencer à `1.0.0`

Arguments passés par l'utilisateur : $ARGUMENTS

## 3. Générer les release notes

Write the release notes **in English**, from a user perspective (not technical). Use markdown with categories if relevant (New, Improvements, Fixes). Be concise. If the user provided context in the arguments, use it to enrich the notes.

## 4. Afficher le résumé et demander confirmation

Affiche :
- Version courante → nouvelle version
- Nombre de fichiers modifiés
- Release notes générées

Demande confirmation avant de continuer (utilise AskUserQuestion).

## 5. Insérer la release en base

Utilise le MCP tool `tool_createRelease` avec :
- `version` : la nouvelle version (sans le "v")
- `title` : un titre court résumant la release
- `content` : les release notes en markdown

Si le MCP tool n'est pas disponible, utilise mongosh comme fallback :
```bash
mongosh "$PANORAMA_MONGO_URI" --eval 'db.releases.insertOne({version:"...",title:"...",content:"...",createdBy:"...",createdAt:new Date()})'
```

## 6. Commit + tag + push

- `git add -A`
- Commit avec les release notes dans le message (format : "release: v{version} — {title}")
- `git tag v{version}`
- `git push origin main --tags`

IMPORTANT : demande confirmation avant le push.
