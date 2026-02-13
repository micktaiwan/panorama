# Panoramix — Plan de migration

Fusion de Panorama (gestion de projets/notes, Meteor) et Organizer (chat, Tauri/Express/Android) en une seule app avec 3 clients indépendants (web, desktop, Android) partageant le même backend Express API.

## Stack technique

- **Backend** : Express 5, TypeScript, Mongoose 9, Socket.io 4, Zod 4
- **Frontend** : React 19, TypeScript, Vite 7, CSS Variables (light/dark)
- **Desktop** : Tauri 2.0 (shell, fs, notifications, clipboard)
- **Android** : Kotlin natif (MVVM, Retrofit, Room DB, Socket.io)
- **Infra** : Docker, Nginx, MongoDB 5, Qdrant v1.16.3

## Serveur OVH existant (51.210.150.25)

Infrastructure Organizer déjà en place :
- **MongoDB 5** (container `organizer-mongodb`, port 27017 interne)
- **Qdrant v1.16.3** (container `organizer-qdrant`, port 6333 interne)
- **API Express Organizer** (container `organizer-api`, port 3001)
- **Réseau** : `organizer-network` (bridge)

Panoramix s'ajoute sur ce réseau avec sa propre DB `panoramix` et sa propre collection Qdrant.

## Serveurs de développement

- **Backend** : `cd backend && npm run dev` → http://localhost:3002
- **Frontend** : `cd frontend && npm run dev` → http://localhost:5173
- **MongoDB** : 127.0.0.1:3001 (instance Meteor locale), DB `panoramix`
- **Qdrant** : localhost:6333
- **User test** : username `david`, password `test123` (admin)

---

## Phase 1 : Backend API ✅

### 1.1 Setup + Auth ✅
- [x] Express 5 + TypeScript + Mongoose 9 + Socket.io 4
- [x] Auth JWT + bcrypt (register/login/me), rôles admin/user
- [x] Données scoped par `userId`
- [x] Docker-compose dev (MongoDB + Qdrant)

### 1.2 Modules métier ✅

**P1 — Noyau ✅** : Projects, Tasks, Notes (sessions + lines), Dashboard (overview)
**P2 — Organisation ✅** : People (normalizedName, search), Teams (can-remove, reassign), Links (click tracking, auto https://), Files (multer 50MB, auth'd download), Alarms (snooze, dismiss, recurring)
**P3 — Avancé ✅** : Budget (import bulk, dedup MD5, summary aggregate), Calendar (week nav, date range), Situations (actors, notes, summaries, cascade delete), User Logs (Qdrant indexing)
**P4 — Intégrations ✅** : Gmail (OAuth2, sync, archive/trash, labels, stats), Notion (sync paginée background via API), MCP Servers (CRUD, test HTTP JSON-RPC, call tool)

### 1.3 Services transversaux ✅
- [x] AI/LLM Proxy (Ollama + OpenAI) : `services/llmProxy.ts`, `aiCore.ts`, `config.ts`
- [x] Vector Store Qdrant : `services/vectorStore.ts`, `vectorIndex.ts` (fire-and-forget)
- [x] Search : `routes/search.ts` (GET /search, /ai-status, /collection-info)
- [x] Socket.io events sur toutes les mutations
- [ ] Collection errors + logging structuré

### Totaux backend
- 21 modèles, 18 routes
- Toutes les routes testées via curl

---

## Phase 2 : Frontend React ✅

### 2.1 Setup ✅
- [x] React 19 + Vite 7 + TypeScript
- [x] API client complet (`services/api.ts`)
- [x] Socket client (`services/socket.ts`)
- [x] Contexts Auth + Theme (light/dark)

### 2.2 Modules UI — 17 tabs ✅
- [x] Accueil (Dashboard), Projets, Tâches, Notes
- [x] Personnes, Liens, Fichiers, Alarmes
- [x] Budget, Calendrier, Situations, Journal
- [x] Recherche (sémantique Qdrant)
- [x] MCP, Notion, Gmail
- [x] Terminal (desktop-only, message informatif sur web)
- [ ] Preferences, Command Palette (non implémentés)

### 2.3 Tauri Desktop ✅ (code complet, build bloqué)
- [x] `src-tauri/` complet (tauri.conf.json, Cargo.toml, lib.rs, capabilities, icons)
- [x] `src/platform/` : `isTauri()`, `execCommand()`, `spawnCommand()`
- [x] Packages npm Tauri installés, scripts `tauri:dev` / `tauri:build`
- **BLOQUÉ** : `sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf`

### Totaux frontend
- 105 modules, 307KB JS (gzip 91KB)

---

## Phase 3 : Android — NON COMMENCÉ

- [ ] Partir de la base Organizer Android (MVVM, Retrofit, Room DB)
- [ ] Adapter l'API client pour les endpoints Panoramix
- [ ] P1 : Projects, Tasks, Notes, Dashboard
- [ ] P2 : People, Links, Files, Alarms, Search
- [ ] P3 : Budget, Calendar, Situations, User Logs
- [ ] GPS, Caméra, Notifications push, Offline, Widget

---

## Phase 4 : Déploiement OVH — INFRA PRÊTE, DEPLOY EN ATTENTE

### Fichiers créés ✅
- [x] `backend/Dockerfile` — multi-stage Node 20 Alpine, user non-root
- [x] `backend/docker-entrypoint.sh` — fix ownership volumes
- [x] `docker-compose.prod.yml` — panoramix-api (:3002) + panoramix-web (nginx :8080), réseau `organizer-network` externe
- [x] `nginx/panoramix.conf` — proxy /api/ → API, /socket.io/ → WS, SPA fallback
- [x] `frontend/.env.production` — `VITE_API_URL=/api`
- [x] `.env.example` — template prod
- [x] `scripts/deploy.sh` — check espace, vérif Organizer, build, rsync, docker build, health check
- [x] `scripts/backup.sh` — mongodump + scp + rotation 7j

### Accès SSH — BLOQUÉ
- Clé `~/.ssh/id_ed25519.pub` (SHA256:pNEDMRdqoEr5gwgd1XJqlltoTJy2bU73J680z1BrZlg)
- La clé est envoyée mais **rejetée** par le serveur
- Mick dit l'avoir ajoutée — vérifier : quelle clé exactement, dans quel `authorized_keys`, quel user

### Avant premier deploy — Nettoyage serveur
```bash
df -h / && sudo docker system df
sudo docker image prune -af && sudo docker builder prune -af && sudo docker volume prune -f
sudo journalctl --vacuum-time=7d
sudo apt autoremove -y && sudo apt clean
```

### Reste à faire
- [ ] Résoudre accès SSH
- [ ] Nettoyage serveur
- [ ] Premier deploy : `./scripts/deploy.sh`
- [ ] SSL Let's Encrypt
- [ ] Nom de domaine
- [ ] Cron backup automatique

---

## Phase 5 : Migration données — SCRIPTS PRÊTS

- [x] `scripts/migrate-panorama.ts` — lit NDJSON.gz Panorama, mappe IDs Meteor → ObjectId, réassigne userId, bulk upsert (22 collections)
- [x] `scripts/reindex-qdrant.ts` — recompute embeddings post-migration
- [ ] Exporter depuis Panorama (feature existante)
- [ ] Exécuter migration + reindex
- [ ] Vérifier intégrité

---

## Phase 6 : Intégration Organizer — NON COMMENCÉ

- [ ] Chat temps réel (rooms, messages, typing, réactions)
- [ ] Appels WebRTC (audio/vidéo, partage écran)
- [ ] Contacts
- [ ] Agent IA Eko (reflection, MCP)
- [ ] Galerie média, Labels

---

## Prochaines étapes (dans l'ordre)

1. **Résoudre accès SSH OVH** (vérifier avec Mick)
2. **Nettoyage serveur** puis premier deploy
3. **Phase 3** — Android (nécessite SDK Kotlin)
4. **Phase 5** — Migration données Panorama
5. **Phase 6** — Chat Organizer

## Décisions prises

- **Tauri** pour le desktop ✅
- **Volume Docker** pour les fichiers (pas de MinIO pour l'instant) ✅
- **Réseau organizer-network partagé** (MongoDB + Qdrant réutilisés) ✅
- **Multi-tenant** (données isolées par userId) ✅

## Décisions en attente

1. Nom de domaine OVH ?
2. Ollama sur le VPS ? (selon ressources)
3. Firebase pour push notifications Android, ou polling ?
