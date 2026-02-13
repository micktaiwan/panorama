#!/bin/bash
set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER="ubuntu@51.210.150.25"
REMOTE_PATH="/opt/panoramix"
COMPOSE_FILE="docker-compose.prod.yml"

echo "=== Panoramix — Déploiement ==="
echo "Projet: $PROJECT_DIR"
echo "Serveur: $SERVER:$REMOTE_PATH"
echo ""

# 0. Vérification espace disque
echo "[1/7] Vérification espace disque..."
AVAILABLE_GB=$(ssh $SERVER "df -BG / | tail -1 | awk '{print \$4}' | sed 's/G//'")
echo "  Espace disponible: ${AVAILABLE_GB}GB"

if [ "$AVAILABLE_GB" -lt 2 ]; then
  echo "  Espace faible (<2GB). Nettoyage Docker..."
  ssh $SERVER "sudo docker system prune -af"
  AVAILABLE_GB=$(ssh $SERVER "df -BG / | tail -1 | awk '{print \$4}' | sed 's/G//'")
  echo "  Espace après nettoyage: ${AVAILABLE_GB}GB"
  if [ "$AVAILABLE_GB" -lt 2 ]; then
    echo "ERREUR: Toujours <2GB. Déploiement annulé."
    exit 1
  fi
fi

# 1. Vérifier que Organizer tourne (MongoDB + Qdrant)
echo "[2/7] Vérification Organizer (MongoDB + Qdrant)..."
MONGO_OK=$(ssh $SERVER "sudo docker ps --format '{{.Names}}' | grep organizer-mongodb || echo ''")
QDRANT_OK=$(ssh $SERVER "sudo docker ps --format '{{.Names}}' | grep organizer-qdrant || echo ''")

if [ -z "$MONGO_OK" ] || [ -z "$QDRANT_OK" ]; then
  echo "ERREUR: organizer-mongodb ou organizer-qdrant ne tourne pas."
  echo "  MongoDB: ${MONGO_OK:-DOWN}"
  echo "  Qdrant: ${QDRANT_OK:-DOWN}"
  exit 1
fi
echo "  MongoDB: OK  |  Qdrant: OK"

# 2. Arrêter l'ancien Panorama Meteor
echo "[3/7] Arrêt ancien Panorama Meteor..."
METEOR_OK=$(ssh $SERVER "sudo docker ps --format '{{.Names}}' | grep -x panoramix || echo ''")
if [ -n "$METEOR_OK" ]; then
  ssh $SERVER "sudo docker stop panoramix && sudo docker rm panoramix"
  echo "  Ancien container Meteor arrêté et supprimé"
else
  echo "  Pas de container Meteor en cours"
fi

# 3. Build frontend
echo "[4/7] Build frontend..."
cd "$PROJECT_DIR/frontend"
npm run build
echo "  Build OK: $(ls -lh dist/assets/index-*.js | awk '{print $5}')"

# 4. Sync fichiers
echo "[5/7] Synchronisation fichiers..."
ssh $SERVER "sudo mkdir -p $REMOTE_PATH && sudo chown -R ubuntu:ubuntu $REMOTE_PATH"

# Backend
rsync -avz --exclude 'node_modules' --exclude 'dist' --exclude '.env' --exclude 'public/uploads' \
  "$PROJECT_DIR/backend/" $SERVER:$REMOTE_PATH/backend/

# Frontend dist
rsync -avz "$PROJECT_DIR/frontend/dist/" $SERVER:$REMOTE_PATH/frontend/dist/

# Nginx config
rsync -avz "$PROJECT_DIR/nginx/" $SERVER:$REMOTE_PATH/nginx/

# Docker compose
rsync -avz "$PROJECT_DIR/docker-compose.prod.yml" $SERVER:$REMOTE_PATH/

echo "  Fichiers synchronisés"

# 5. Build et restart sur le serveur
echo "[6/7] Build et restart containers..."
ssh $SERVER << 'EOF'
  cd /opt/panoramix

  # Créer .env si n'existe pas
  if [ ! -f .env ]; then
    echo "JWT_SECRET=$(openssl rand -base64 32)" > .env
    echo "CORS_ORIGIN=*" >> .env
    echo "AI_MODE=remote" >> .env
    echo "  .env créé (remplir OPENAI_API_KEY manuellement)"
  fi

  # S'assurer que le réseau existe
  sudo docker network inspect server_organizer-network >/dev/null 2>&1 || {
    echo "ERREUR: réseau server_organizer-network introuvable"
    exit 1
  }

  # Build et restart
  sudo docker compose -f docker-compose.prod.yml up -d --build

  # Status
  echo ""
  echo "=== Containers ==="
  sudo docker compose -f docker-compose.prod.yml ps

  # Cleanup
  sudo docker image prune -f 2>/dev/null || true
  sudo docker builder prune -f 2>/dev/null || true
EOF

# 6. Health check
echo "[7/7] Health check..."
sleep 8

HEALTH=$(ssh $SERVER "sudo docker exec panoramix-api wget -q -O- http://localhost:3002/health 2>/dev/null || echo 'FAIL'")
echo "  API: $HEALTH"

WEB=$(ssh $SERVER "sudo docker exec panoramix-web wget -q -O- http://localhost:80/ 2>/dev/null | head -1 || echo 'FAIL'")
echo "  Web: $(echo $WEB | head -c 50)"

echo ""
echo "=== Déploiement terminé ==="
echo "URL: https://panorama.mickaelfm.me"
