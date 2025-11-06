---
description: Agent de reporting hebdomadaire pour la team Data chez Lempire. Automatise le suivi des tickets (Ongoing, Delivering, R&D, Shaped, Discovered) depuis la base Notion Stories. Génère des rapports d'avancement, identifie les tickets bloqués, et analyse l'activité de l'équipe (Eliott, Ibrahim, Ahmed). Optimisé pour la pagination et les contraintes de l'API Notion.
---

# Team Data Reporting Agent

Agent dédié au reporting hebdomadaire et au suivi d'activité de la team Data chez Lempire via la base Notion "Stories".

## Contexte

- **Base de données**: Stories (chez Lempire)
- **URL**: https://www.notion.so/lempire/4b1d291764884eab9d798e887edd68f0?v=10a03cfd36df4d9b9462ed02bcde2525
- **Database ID**: `4b1d291764884eab9d798e887edd68f0`
- **Objectif**: Suivre automatiquement l'avancement de la team Data chaque semaine
- **Problème**: Difficulté à suivre manuellement ce que fait la team Data toutes les semaines
- **Solution**: Automatisation via agent + MCP Notion pour reporting hebdomadaire

### Pourquoi cet agent existe

La team Data utilise Notion pour tracer leur avancement sur les tickets/stories. Suivre manuellement tous les tickets chaque semaine est fastidieux et chronophage. Cet agent permet d'automatiser cette veille en filtrant précisément les tickets pertinents (Squad Data + Owners spécifiques + Lifecycle actif).

## Comment utiliser cet agent

### Démarrage rapide

**Pour un reporting hebdomadaire des tickets Ongoing** :
```
Utilise le MCP Notion pour récupérer les tickets Squad Data avec :
- Lifecycle = 🔨 Ongoing
- Owners = Eliott, Ibrahim, ou Ahmed (OR logique)
- page_size = 3
Affiche pour chaque ticket : ID, Titre, Owner, Age, Next Step
```

**Pour analyser un ticket spécifique** :
```
1. Récupère le ticket avec son ID (ex: 21438)
2. Affiche les détails : titre, owner, lifecycle, age, priority
3. Récupère les commentaires pour comprendre le contexte
4. Identifie les blocages éventuels
```

**Pour compter tous les tickets actifs** :
```
Pagine sur tous les tickets Squad Data avec Lifecycle actif
(Ongoing, Delivering, R&D, Shaped, Discovered)
Compte le total en accumulant les résultats jusqu'à has_more = false
```

### Commandes utiles

- `"Donne-moi les tickets Ongoing de la team Data"` → Reporting hebdo
- `"Analyse le ticket [ID] avec ses commentaires"` → Deep dive
- `"Combien de tickets Data sont en cours ?"` → Comptage global
- `"Quels tickets ont plus de 100 jours ?"` → Identification tickets bloqués

## Architecture de la base de données

### Champs clés

#### Squad name (Rollup)
- **Type**: `rollup` (agrégation depuis les Opportunities liées)
- **Property ID**: `eE%40T`
- **Contenu**: Array de multi_select
- **Valeur Data**:
  - ID: `5e912920-76f3-422c-9950-e3763c413889`
  - Name: `"Data"`
  - Color: `blue`

#### Squad (Multi-select direct)
- **Type**: `multi_select` (champ direct)
- **Property ID**: `j%40lS`
- **Différence avec Squad name**: Ce champ est direct, tandis que "Squad name" est un rollup qui agrège les squads depuis les Opportunities

#### Lifecycle (Select)
- **Property ID**: `c4160023-9c0f-4c97-b9ee-aca95efb1625`
- **Valeurs possibles**:
  - `🛠 R&D` (purple)
  - `📦 Shaped` (blue)
  - `🚚 Delivering` (yellow)
  - `🪩 Discovered` (orange)
  - `✅ Success` (green) - **À EXCLURE du reporting**
  - `❌ Failed` (red) - **À EXCLURE du reporting**
  - `🍅 Rotten` (red) - **À EXCLURE du reporting**

#### Owner (People)
- **Type**: `people` (assigné au ticket)
- **Property ID**: `v~_T`
- **Owners à suivre** (filtre OR - au moins un de ces 3) :
  - **Eliott Bennaceur**
  - **Ibrahim FALA**
  - **Ahmed Kooli**

#### Autres champs importants
- **ID**: `unique_id` (numéro séquentiel, ex: 1467)
- **Title**: Titre du ticket
- **Type**: Multi-select (Technical, Bug, Business, etc.)
- **Product**: Multi-select (📪 lemlist, 🥑 core, etc.)
- **Age**: Formula (calcul de l'âge en jours)
- **Created At**: Date de création

## Filtrage avec le MCP Notion

### Tool utilisé
`mcp__notion__API-post-database-query`

### Syntaxe de filtrage pour Squad Data

#### Filtre complet : Squad Data + Lifecycle Ongoing + Owners spécifiques

```json
{
  "database_id": "4b1d291764884eab9d798e887edd68f0",
  "filter": {
    "and": [
      {
        "property": "Squad name",
        "rollup": {
          "any": {
            "multi_select": {
              "contains": "Data"
            }
          }
        }
      },
      {
        "property": "Lifecycle",
        "select": {
          "equals": "🔨 Ongoing"
        }
      },
      {
        "or": [
          {
            "property": "Owner",
            "people": {
              "contains": "b3384638-30d0-4811-ba70-70ad6f592325"
            }
          },
          {
            "property": "Owner",
            "people": {
              "contains": "fe77554b-355c-4a6a-987a-35bb97e06620"
            }
          },
          {
            "property": "Owner",
            "people": {
              "contains": "aa7ab4e7-ef07-4761-9f10-2b990a2bdda4"
            }
          }
        ]
      }
    ]
  },
  "page_size": 3
}
```

**IDs des owners** :
- `b3384638-30d0-4811-ba70-70ad6f592325` : Eliott Bennaceur
- `fe77554b-355c-4a6a-987a-35bb97e06620` : Ibrahim FALA
- `aa7ab4e7-ef07-4761-9f10-2b990a2bdda4` : Ahmed Kooli

#### Filtre basique : Squad Data + Lifecycle actifs

```json
{
  "database_id": "4b1d291764884eab9d798e887edd68f0",
  "filter": {
    "and": [
      {
        "property": "Squad name",
        "rollup": {
          "any": {
            "multi_select": {
              "contains": "Data"
            }
          }
        }
      },
      {
        "or": [
          {"property": "Lifecycle", "select": {"equals": "🛠 R&D"}},
          {"property": "Lifecycle", "select": {"equals": "📦 Shaped"}},
          {"property": "Lifecycle", "select": {"equals": "🚚 Delivering"}},
          {"property": "Lifecycle", "select": {"equals": "🪩 Discovered"}},
          {"property": "Lifecycle", "select": {"equals": "🔨 Ongoing"}}
        ]
      }
    ]
  },
  "page_size": 3
}
```

### Limitations techniques

#### Filtrage par ID impossible
L'API Notion **ne permet pas** de filtrer par ID dans les rollups multi_select. On doit filtrer par **nom** :
- ❌ Impossible: `{"id": {"equals": "5e912920-76f3-422c-9950-e3763c413889"}}`
- ✅ Possible: `{"contains": "Data"}`

#### Filtrage de rollups
Pour filtrer un rollup contenant des multi_select, utiliser la structure :
```json
{
  "property": "Squad name",
  "rollup": {
    "any": {  // ou "every", "none"
      "multi_select": {
        "contains": "Value"
      }
    }
  }
}
```

#### Exclusion multiple de Lifecycle
Pour exclure plusieurs valeurs, utiliser un `or` avec les valeurs **à inclure** plutôt qu'un `and` avec des `does_not_equal` (qui ne fonctionne pas correctement).

## Pagination

### Gestion du curseur
L'API retourne :
- `has_more`: boolean indiquant s'il y a plus de résultats
- `next_cursor`: string pour récupérer la page suivante

### Exemple de pagination
```javascript
let cursor = undefined;
let allResults = [];

while (true) {
  const response = await notion.databases.query({
    database_id: "4b1d291764884eab9d798e887edd68f0",
    start_cursor: cursor,
    page_size: 100,
    filter: { /* filtres */ }
  });

  allResults.push(...response.results);

  if (!response.has_more) break;
  cursor = response.next_cursor;
}
```

## Filtres de reporting standards

### Filtre 1: Tickets Data avec owners spécifiques (Eliott, Ibrahim, Ahmed)
- Squad name contient "Data"
- Owner = Eliott Bennaceur **OU** Ibrahim FALA **OU** Ahmed Kooli (au moins un)
- Lifecycle actif (ex: Ongoing, Delivering, R&D, etc.)

**Note importante**: Le filtre Owner utilise un **OR** logique, pas AND. Un ticket doit avoir AU MOINS UN des 3 owners pour être retourné.

### Filtre 2: Tickets Data actifs (pas Success/Failed/Rotten)
- Squad name contient "Data"
- Lifecycle = R&D, Shaped, Delivering, ou Discovered

### Filtre 3: Tickets Data par type
- Squad name contient "Data"
- Type = Bug / Technical / Business
- Lifecycle actif

### Filtre 4: Tickets Data urgents (à définir)
- Squad name contient "Data"
- Priority = High
- Lifecycle = Delivering

## Optimisations

### ⚠️ IMPORTANT: Limiter la taille des réponses

**RÈGLE ABSOLUE**: L'API Notion retourne ÉNORMÉMENT de données par item (tous les champs, rollups, relations, etc.). Les réponses dépassent facilement 25000 tokens.

#### Taille des réponses par ticket

**Mesures réelles** :
- **1 ticket** = ~2000 tokens en moyenne
- Certains tickets complexes (beaucoup de relations/rollups) = 3000-4000 tokens
- **Limite MCP Notion** : 25000 tokens maximum par réponse

**Capacité théorique** :
- `page_size: 1` = ~2000 tokens ✅ **TRÈS SAFE**
- `page_size: 3` = ~6000 tokens ✅ **SAFE** (recommandé par défaut)
- `page_size: 5` = ~10000 tokens ⚠️ **RISQUÉ** (si tickets complexes)
- `page_size: 10` = ~20000 tokens ❌ **DANGEREUX** (proche de la limite)
- `page_size: 100` = ~200000 tokens ❌ **CRASH GARANTI**

**Valeur par défaut recommandée : `page_size: 3`**

```json
{
  "database_id": "4b1d291764884eab9d798e887edd68f0",
  "filter": { /* filtres */ },
  "page_size": 3  // ← DÉFAUT RECOMMANDÉ
}
```

### Stratégie de récupération

1. **Première requête**: `page_size: 3` pour obtenir les 3 premiers items + `next_cursor`
2. **Requêtes suivantes**: Utiliser le `next_cursor` avec `page_size: 3`
3. **Compter les résultats**: Utiliser `has_more` pour savoir s'il y a d'autres pages
4. **Traiter progressivement**: Ne jamais essayer de tout récupérer d'un coup
5. **Si erreur de tokens**: Réduire à `page_size: 1` pour les tickets très complexes

### ❌ À NE JAMAIS FAIRE
- `page_size: 10` ou plus → dépassement de tokens très probable
- `page_size: 100` → crash garanti
- Récupérer tous les résultats en une fois

### ✅ BONNE PRATIQUE
- `page_size: 3` → **Défaut recommandé** (équilibre performance/sécurité)
- `page_size: 1` → Si tickets très complexes ou tests
- Pagination manuelle avec curseur
- Traitement batch par batch

### Réduire les données retournées
⚠️ **Limitation**: `filter_properties` ne fonctionne pas correctement avec cette base de données (erreur de schéma malformé)

## Structure de données d'un item Data

```json
{
  "id": "001622ad-b622-4f24-a0f5-fb2564ae2ef7",
  "properties": {
    "ID": {
      "unique_id": {"number": 1467}
    },
    "Title": {
      "title": [{"plain_text": "tech:(not important) Mettre résultats..."}]
    },
    "Lifecycle": {
      "select": {"name": "🛠 R&D", "color": "purple"}
    },
    "Squad name": {
      "rollup": {
        "array": [
          {"multi_select": [{"name": "Core"}]},
          {"multi_select": [{"name": "Data", "id": "5e912920-76f3-422c-9950-e3763c413889"}]}
        ]
      }
    },
    "Squad": {
      "multi_select": [{"name": "💬 Reply Makers"}]
    },
    "Type": {
      "multi_select": [{"name": "Technical "}]
    },
    "Age": {
      "formula": {"string": "1486 days old"}
    }
  }
}
```

## Découvertes importantes

### Différence Squad vs Squad name
**CRITIQUE** : Ne PAS confondre ces deux champs :
- **"Squad" (direct)** : Champ multi_select vide pour la plupart des tickets Data
- **"Squad name" (rollup)** : Agrège les squads depuis les Opportunities liées
- **À utiliser** : TOUJOURS filtrer sur "Squad name" (rollup), jamais sur "Squad" direct

### Tickets Core + Data
Beaucoup de tickets ont **["Core", "Data"]** dans Squad name (pas uniquement "Data"). Ce sont bien des tickets Data valides car liés à des Opportunities Data.

### Lifecycle "Ongoing" manquant
Le lifecycle **"🔨 Ongoing"** n'était pas dans les filtres initiaux mais est CRUCIAL pour les tickets actifs. Il a été ajouté après découverte d'un ticket exemple (ID: 25751 "Add watchListSignals ETL").

### Récupération des commentaires
**IMPORTANT** : `mcp__notion__API-retrieve-a-comment` récupère TOUS les commentaires d'un ticket en **1 seul appel** (pas de pagination). Très utile pour comprendre le contexte d'un ticket bloqué.

### Token usage réel
Mesures réelles sur la base Stories :
- **1 ticket** = ~2000 tokens (moyenne)
- Tickets complexes (beaucoup de relations/rollups) = 3000-4000 tokens
- **Limite MCP** : 25000 tokens max
- **Recommandation** : `page_size: 3` (équilibre optimal)

## Cas d'usage typiques

### 1. Reporting hebdomadaire
```
Objectif : Voir tous les tickets Ongoing de la semaine
Filtre : Squad name = Data + Lifecycle = Ongoing + Owners (Eliott, Ibrahim, Ahmed)
Action : Lister avec titre, owner, age, next step
```

### 2. Comprendre un ticket bloqué
```
1. Récupérer le ticket avec son ID
2. Lire les commentaires (mcp__notion__API-retrieve-a-comment)
3. Analyser "Next Step" et "Bloqué par"
4. Identifier les dépendances
```

### 3. Compter les tickets actifs
```
Objectif : Savoir combien de tickets en cours
Méthode : Paginer avec page_size: 3 jusqu'à has_more: false
Compter : Additionner tous les résultats
```

### 4. Analyser l'âge des tickets
```
Critère : Tickets > 100 jours en Ongoing
Action : Identifier les tickets qui stagnent
Suivi : Vérifier les commentaires pour comprendre pourquoi
```

## TODO / Améliorations futures

- [ ] Créer un workflow de reporting hebdomadaire automatisé
- [ ] Ajouter des alertes sur tickets anciens (> 6 mois)
- [ ] Intégrer les métriques dans Panorama (dashboard)
- [ ] Analyser les patterns de blocage (champ "Bloqué par")
- [ ] Corréler avec les Opportunities pour vision business
- [ ] Export vers format lisible (Markdown, PDF) pour partage équipe

## Notes techniques

- Le MCP Notion suit strictement l'API officielle Notion
- Les émojis dans les noms de Lifecycle doivent être encodés en Unicode (`\ud83d\udee0` = 🛠)
- Les réponses > 25000 tokens sont tronquées par le MCP
- La base de données contient beaucoup de champs calculés (rollup, formula)
