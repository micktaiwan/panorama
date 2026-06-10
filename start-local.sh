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

# NOTE: pas de mongosh ping ici — il ajoutait 2–5 s de latence visible
# avant que la fenêtre Electron n'apparaisse. Si Mongo est down, Meteor
# le signalera tout seul dans les logs.

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
MAIL_USER="${PANORAMA_MAIL_USER:-}"
MAIL_PASS="${PANORAMA_MAIL_PASS:-}"
if [ -n "$MAIL_USER" ] && [ -n "$MAIL_PASS" ]; then
  export MAIL_URL="smtp://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$MAIL_USER', safe=''))"):$(python3 -c "import urllib.parse; print(urllib.parse.quote('$MAIL_PASS', safe=''))")@mail.mickaelfm.me:587"
fi

echo "→ Lancement Electron (splash) + Meteor (port $METEOR_PORT)..."
echo "  MONGO_URL        = mongodb://${MONGO_USER}:***@${MONGO_HOST}/panorama?${MONGO_OPTS}"
echo "  MONGO_OPLOG_URL  = mongodb://${MONGO_USER}:***@${MONGO_HOST}/local?${MONGO_OPTS}"
echo "  QDRANT_URL       = $QDRANT_URL"

# Lancer Electron immédiatement en background (le splash apparaît tout de suite,
# pendant que Meteor compile et se connecte). Electron poll Meteor et bascule
# sur l'URL réelle quand le serveur répond.
METEOR_PORT=$METEOR_PORT ./node_modules/.bin/electron . &
ELECTRON_PID=$!

# Meteor en background aussi, pour pouvoir surveiller les deux process.
# (auparavant Meteor tournait au premier plan : quitter Electron laissait
#  Meteor orphelin car rien ne reliait la mort d'Electron à l'arrêt du script)
npm run dev:meteor:4000 &
METEOR_PID=$!

# Tue un PID et toute sa descendance (npm → meteor → node app).
# Ciblé sur les descendants directs : ne touche pas d'autres instances Meteor
# (ex: un `meteor test` qui tournerait en parallèle).
kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null
}

# --- INSTRUMENTATION TEMPORAIRE (à retirer après diagnostic) ---
QLOG=/tmp/panorama-quit.log
qlog() { echo "$(date '+%H:%M:%S') $*" | tee -a "$QLOG"; }
: > "$QLOG"
qlog "START electron=$ELECTRON_PID meteor=$METEOR_PID (pid script=$$)"

# Quoi qu'il arrive (quit Electron, Ctrl+C, arrêt de Meteor) → tout s'arrête.
cleanup() {
  trap - EXIT INT TERM
  qlog "CLEANUP electron alive=$(kill -0 "$ELECTRON_PID" 2>/dev/null && echo yes || echo no) meteor alive=$(kill -0 "$METEOR_PID" 2>/dev/null && echo yes || echo no)"
  kill_tree "$ELECTRON_PID"
  kill_tree "$METEOR_PID"
  qlog "CLEANUP done"
}
trap cleanup EXIT INT TERM

# Attendre que l'un des deux se termine ; le trap EXIT tue alors l'autre.
# (compatible bash 3.2 et zsh — pas de `wait -n`)
while kill -0 "$ELECTRON_PID" 2>/dev/null && kill -0 "$METEOR_PID" 2>/dev/null; do
  sleep 1
done
qlog "LOOP EXIT electron alive=$(kill -0 "$ELECTRON_PID" 2>/dev/null && echo yes || echo no) meteor alive=$(kill -0 "$METEOR_PID" 2>/dev/null && echo yes || echo no)"
