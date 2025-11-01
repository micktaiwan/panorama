# Notion Data Squad Agent

Agent spécialisé pour accélérer la recherche et le reporting des tickets de la Squad Data dans la base de données Notion "Stry".

## Contexte

- **Base de données**: Stry (Stories)
- **URL**: https://www.notion.so/lempire/4b1d291764884eab9d798e887edd68f0?v=10a03cfd36df4d9b9462ed02bcde2525
- **Database ID**: `4b1d291764884eab9d798e887edd68f0`
- **Objectif**: Filtrer et reporter les tickets assignés à la Squad Data

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

#### Autres champs importants
- **ID**: `unique_id` (numéro séquentiel, ex: 1467)
- **Title**: Titre du ticket
- **Type**: Multi-select (Technical, Bug, Business, etc.)
- **Product**: Multi-select (📪 lemlist, 🥑 core, etc.)
- **Owner**: People (assigné)
- **Age**: Formula (calcul de l'âge en jours)
- **Created At**: Date de création

## Filtrage avec le MCP Notion

### Tool utilisé
`mcp__notion__API-post-database-query`

### Syntaxe de filtrage pour Squad Data

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
          {"property": "Lifecycle", "select": {"equals": "🪩 Discovered"}}
        ]
      }
    ]
  },
  "page_size": 1
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

### Filtre 1: Tickets Data actifs (pas Success/Failed/Rotten)
- Squad name contient "Data"
- Lifecycle = R&D, Shaped, Delivering, ou Discovered

### Filtre 2: Tickets Data par type
- Squad name contient "Data"
- Type = Bug / Technical / Business
- Lifecycle actif

### Filtre 3: Tickets Data urgents (à définir)
- Squad name contient "Data"
- Priority = High
- Lifecycle = Delivering

## Optimisations

### Limiter la taille des réponses
- Utiliser `page_size: 1` pour les tests
- Utiliser `page_size: 100` (max) pour la production
- **Problème**: Les réponses peuvent dépasser 25000 tokens → nécessite pagination

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

## TODO / Améliorations futures

- [ ] Définir les filtres de reporting supplémentaires
- [ ] Créer des scripts d'extraction batch
- [ ] Ajouter des filtres par date (Working dates, Created At)
- [ ] Définir les métriques de reporting (nombre de tickets, âge moyen, etc.)
- [ ] Gérer les tickets bloqués (relation "Bloqué par")
- [ ] Analyser les Opportunities liées

## Notes techniques

- Le MCP Notion suit strictement l'API officielle Notion
- Les émojis dans les noms de Lifecycle doivent être encodés en Unicode (`\ud83d\udee0` = 🛠)
- Les réponses > 25000 tokens sont tronquées par le MCP
- La base de données contient beaucoup de champs calculés (rollup, formula)
