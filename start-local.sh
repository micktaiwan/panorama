#!/usr/bin/env bash
# start-local.sh — Lance Panorama en mode local
#
# MongoDB remote : panorama.mickaelfm.me:27018 (TLS + auth)
# Qdrant remote  : localhost:16333 → VPS:6333 (tunnel SSH)
# MongoDB local  : localhost:4001  → .meteor/local/db (collections local-only)

VPS_HOST="${PANORAMA_VPS_HOST:?Définir PANORAMA_VPS_HOST (ex: export PANORAMA_VPS_HOST=ubuntu@your-vps-ip)}"
MONGO_USER="${PANORAMA_MONGO_USER:?Définir PANORAMA_MONGO_USER dans ~/.env.secrets}"
MONGO_PASS="${PANORAMA_MONGO_PASS:?Définir PANORAMA_MONGO_PASS dans ~/.env.secrets}"
MONGO_HOST="panorama.mickaelfm.me:27018"
QDRANT_TUNNEL_PORT=16333
METEOR_PORT=4000

# Tunnel SSH pour Qdrant (MongoDB n'en a plus besoin grâce au TLS)
if lsof -i :$QDRANT_TUNNEL_PORT -P -n >/dev/null 2>&1; then
  echo "✓ Tunnel Qdrant déjà actif sur :$QDRANT_TUNNEL_PORT"
else
  echo "→ Démarrage du tunnel SSH (Qdrant)..."
  autossh -M 0 -f -N \
    -o "ServerAliveInterval=30" \
    -o "ServerAliveCountMax=3" \
    -L ${QDRANT_TUNNEL_PORT}:localhost:6333 \
    $VPS_HOST
  echo "✓ Tunnel Qdrant démarré"
fi

# Vérifier la connexion MongoDB TLS
echo "→ Vérification MongoDB (TLS)..."
if mongosh --quiet "mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}/panorama?tls=true&authSource=admin&directConnection=true" --eval "db.runCommand({ping:1}).ok" 2>/dev/null | grep -q 1; then
  echo "✓ MongoDB accessible"
else
  echo "✗ MongoDB non accessible sur ${MONGO_HOST}"
  exit 1
fi

# Lancer Meteor
LOCAL_MONGO_PORT=$((METEOR_PORT + 1))
MONGO_URL="mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}/panorama?tls=true&authSource=admin&directConnection=true"
MONGO_OPLOG_URL="mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}/local?tls=true&authSource=admin&directConnection=true"

echo "→ Lancement Meteor (port $METEOR_PORT)..."
echo "  MONGO_URL        = mongodb://${MONGO_USER}:***@${MONGO_HOST}/panorama?tls=true&authSource=admin&directConnection=true"
echo "  MONGO_OPLOG_URL  = mongodb://${MONGO_USER}:***@${MONGO_HOST}/local?tls=true&authSource=admin&directConnection=true"
echo "  LOCAL_MONGO_URL  = mongodb://localhost:${LOCAL_MONGO_PORT}/meteor"
echo "  QDRANT_URL       = http://localhost:${QDRANT_TUNNEL_PORT}"

MONGO_URL="$MONGO_URL" \
MONGO_OPLOG_URL="$MONGO_OPLOG_URL" \
LOCAL_MONGO_URL="mongodb://localhost:${LOCAL_MONGO_PORT}/meteor" \
QDRANT_URL="http://localhost:${QDRANT_TUNNEL_PORT}" \
meteor run --port $METEOR_PORT --settings settings.json
