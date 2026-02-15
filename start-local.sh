#!/usr/bin/env bash
# start-local.sh — Lance Panorama en mode local avec tunnel SSH vers le VPS
#
# MongoDB remote : localhost:27018 → VPS:27017 (collections partagées)
# Qdrant remote  : localhost:16333 → VPS:6333
# MongoDB local  : localhost:3001  → .meteor/local/db (collections local-only)

VPS_HOST="${PANORAMA_VPS_HOST:?Définir PANORAMA_VPS_HOST (ex: export PANORAMA_VPS_HOST=ubuntu@your-vps-ip)}"
MONGO_LOCAL_PORT=27018
QDRANT_LOCAL_PORT=16333
METEOR_PORT=3000

# Tunnel déjà actif ?
if lsof -i :$MONGO_LOCAL_PORT -P -n >/dev/null 2>&1; then
  echo "✓ Tunnel déjà actif sur :$MONGO_LOCAL_PORT et :$QDRANT_LOCAL_PORT"
else
  echo "→ Démarrage du tunnel SSH..."
  autossh -M 0 -f -N \
    -o "ServerAliveInterval=30" \
    -o "ServerAliveCountMax=3" \
    -L ${MONGO_LOCAL_PORT}:localhost:27017 \
    -L ${QDRANT_LOCAL_PORT}:localhost:6333 \
    $VPS_HOST
  echo "✓ Tunnel démarré"
fi

# Attendre que MongoDB réponde
echo "→ Vérification MongoDB via tunnel..."
for i in $(seq 1 10); do
  if mongosh --quiet "mongodb://127.0.0.1:${MONGO_LOCAL_PORT}/" --eval "db.runCommand({ping:1}).ok" 2>/dev/null | grep -q 1; then
    echo "✓ MongoDB accessible"
    break
  fi
  [ $i -eq 10 ] && { echo "✗ MongoDB non accessible après 10 tentatives"; exit 1; }
  sleep 1
done

# Lancer Meteor
LOCAL_MONGO_PORT=$((METEOR_PORT + 1))
echo "→ Lancement Meteor (port $METEOR_PORT)..."
echo "  MONGO_URL        = mongodb://localhost:${MONGO_LOCAL_PORT}/panorama"
echo "  LOCAL_MONGO_URL  = mongodb://localhost:${LOCAL_MONGO_PORT}/meteor"
echo "  MONGO_OPLOG_URL  = mongodb://localhost:${MONGO_LOCAL_PORT}/local"
echo "  QDRANT_URL       = http://localhost:${QDRANT_LOCAL_PORT}"

MONGO_URL="mongodb://localhost:${MONGO_LOCAL_PORT}/panorama" \
MONGO_OPLOG_URL="mongodb://localhost:${MONGO_LOCAL_PORT}/local" \
LOCAL_MONGO_URL="mongodb://localhost:${LOCAL_MONGO_PORT}/meteor" \
QDRANT_URL="http://localhost:${QDRANT_LOCAL_PORT}" \
meteor run --port $METEOR_PORT --settings settings.json
