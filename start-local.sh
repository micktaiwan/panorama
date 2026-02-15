#!/usr/bin/env bash
# start-local.sh — Lance Panorama en mode local
#
# MongoDB : panorama.mickaelfm.me:27018 (TLS + auth, toutes les collections)
# Qdrant  : localhost:16333 → VPS:6333 (tunnel SSH)

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
if mongosh --quiet "mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}/panorama?tls=true&authSource=admin" --eval "db.runCommand({ping:1}).ok" 2>/dev/null | grep -q 1; then
  echo "✓ MongoDB accessible"
else
  echo "✗ MongoDB non accessible sur ${MONGO_HOST}"
  exit 1
fi

# Lancer Meteor
# serverSelectionTimeoutMS=60000 : laisse 60s au driver pour retrouver le serveur après un sleep/wake
# heartbeatFrequencyMS=10000 : sonde le serveur toutes les 10s (réduit les faux positifs au réveil)
MONGO_OPTS="tls=true&authSource=admin&serverSelectionTimeoutMS=60000&heartbeatFrequencyMS=10000"
MONGO_URL="mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}/panorama?${MONGO_OPTS}"
MONGO_OPLOG_URL="mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}/local?${MONGO_OPTS}"

export MONGO_URL MONGO_OPLOG_URL
export QDRANT_URL="http://localhost:${QDRANT_TUNNEL_PORT}"
export PANORAMA_FILES_URL="https://panorama.mickaelfm.me"
export PANORAMA_FILES_API_KEY="${PANORAMA_FILES_API_KEY:?Définir PANORAMA_FILES_API_KEY dans ~/.env.secrets}"

echo "→ Lancement Meteor + Electron (port $METEOR_PORT)..."
echo "  MONGO_URL        = mongodb://${MONGO_USER}:***@${MONGO_HOST}/panorama?${MONGO_OPTS}"
echo "  MONGO_OPLOG_URL  = mongodb://${MONGO_USER}:***@${MONGO_HOST}/local?${MONGO_OPTS}"
echo "  QDRANT_URL       = $QDRANT_URL"

npm run dev:desktop:4000
