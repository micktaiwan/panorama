# Panoramix — Release Notes

## 2026-02-13

### Fix icône fenêtre Tauri (taskbar Windows)
- Ajout feature `image-png` sur le crate `tauri` dans `Cargo.toml`
- Utilisation de `Image::from_bytes()` + `window.set_icon()` dans le setup hook (`lib.rs`)
- Suppression de la dépendance `image` crate (inutile avec le feature natif Tauri)

### Récupération des sources frontend après suppression accidentelle
- 72 fichiers frontend récupérés depuis les transcripts de sessions Claude (JSONL)
- Script Python d'extraction : replay des Write + Edit dans l'ordre chronologique
- Fichiers manquants recréés : `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite-env.d.ts`, `favicon.svg`
- `npm install` refait après perte du `node_modules`

### Initialisation du repo Git
- Branche orpheline `mix` sur `micktaiwan/panorama`
- `.gitignore` : exclut node_modules, dist, target, .env, panorama/, organizer/, image_cache/
- 162 fichiers committés (backend + frontend + scripts + docker + nginx)

### Déploiement
- Web déployé sur https://panorama.mickaelfm.me
- Installer Tauri Windows (.msi + .exe) buildé avec icône compass
