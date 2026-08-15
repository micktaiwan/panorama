#!/usr/bin/env bash
# start-local.sh — Lance Panorama en mode local
#
# MongoDB : localhost:27018 → VPS:27017 (tunnel SSH)
# Qdrant  : localhost:16333 → VPS:6333  (tunnel SSH)
#
# Depuis la migration du 15/08/2026, Mongo n'est plus publie sur Internet : il
# n'ecoute que sur la loopback du VPS. Les deux acces passent donc par un tunnel.

VPS_HOST="${PANORAMA_VPS_HOST:?Définir PANORAMA_VPS_HOST (ex: export PANORAMA_VPS_HOST=ubuntu@your-vps-ip)}"
MONGO_USER="${PANORAMA_MONGO_USER:?Définir PANORAMA_MONGO_USER dans ~/.env.secrets}"
MONGO_PASS="${PANORAMA_MONGO_PASS:?Définir PANORAMA_MONGO_PASS dans ~/.env.secrets}"
MONGO_TUNNEL_PORT=27018
MONGO_HOST="localhost:${MONGO_TUNNEL_PORT}"
QDRANT_TUNNEL_PORT=16333
METEOR_PORT=4000

# tunnel <nom> <port local> <port distant>
#
# Le garde ne se contente PAS de constater que le port est pris : il verifie que
# le tunnel qui le tient va bien vers $VPS_HOST. Le 15/08/2026, apres la bascule
# de VPS, un autossh lance la veille tenait encore :16333 vers l'ANCIENNE machine.
# L'ancien garde (« port occupe → rien a faire ») aurait laisse Panorama lire et
# ecrire le Qdrant de l'ancien VPS sans que rien ne paraisse anormal.
#
# On ne tue pas le tunnel perime tout seul : d'autres sessions peuvent en dependre.
# On s'arrete en disant quoi faire.
tunnel() {
  local name="$1" local_port="$2" remote_port="$3"
  if lsof -i :"$local_port" -P -n >/dev/null 2>&1; then
    if pgrep -f -- "-L ${local_port}:localhost:${remote_port} ${VPS_HOST}" >/dev/null 2>&1; then
      echo "✓ Tunnel $name déjà actif sur :$local_port → $VPS_HOST"
      return 0
    fi
    echo "✗ Le port $local_port est pris, mais pas par un tunnel vers $VPS_HOST :"
    pgrep -fl -- "-L ${local_port}:" 2>/dev/null | sed 's/^/    /'
    echo "  Tuer ce tunnel, puis relancer :"
    echo "    pkill -f 'ssh.*-L ${local_port}:'"
    exit 1
  fi
  echo "→ Démarrage du tunnel SSH ($name)..."
  autossh -M 0 -f -N \
    -o "ServerAliveInterval=30" \
    -o "ServerAliveCountMax=3" \
    -L ${local_port}:localhost:${remote_port} \
    $VPS_HOST
  echo "✓ Tunnel $name démarré"
}

tunnel Mongo  "$MONGO_TUNNEL_PORT"  27017
tunnel Qdrant "$QDRANT_TUNNEL_PORT" 6333

# NOTE: pas de mongosh ping ici — il ajoutait 2–5 s de latence visible
# avant que la fenêtre Electron n'apparaisse. Si Mongo est down, Meteor
# le signalera tout seul dans les logs.

# Lancer Meteor
# serverSelectionTimeoutMS=60000 : laisse 60s au driver pour retrouver le serveur après un sleep/wake
# heartbeatFrequencyMS=10000 : sonde le serveur toutes les 10s (réduit les faux positifs au réveil)
# Plus de tls=true : le trafic est deja chiffre par SSH, et le certificat du Mongo
# est emis pour le nom du conteneur, pas pour localhost — il echouerait a la
# verification du nom d'hote.
#
# directConnection=true est OBLIGATOIRE : le replica set rs0 declare son membre
# comme `organizer-mongodb:27017`, un nom qui n'existe que dans le reseau Docker
# du VPS. Sans ce drapeau, le driver decouvre la topologie, apprend ce nom, essaie
# de s'y connecter et echoue. Verifie le 15/08/2026 : les change streams (dont
# depend toute la reactivite, voir la note plus bas) fonctionnent en connexion
# directe sur un membre de replica set.
MONGO_OPTS="authSource=admin&directConnection=true&serverSelectionTimeoutMS=60000&heartbeatFrequencyMS=10000"
MONGO_URL="mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}/panorama?${MONGO_OPTS}"
# MONGO_OPLOG_URL volontairement NON défini : depuis Mongo 6 + Meteor 3.5, la
# réactivité passe par les Change Streams (driver par défaut). Définir cette URL
# recréerait un handle oplog (mongo/mongo_connection.js) qui tail l'oplog
# cluster-wide — ce qui réintroduisait l'erreur "Unknown command ... drop
# tempusers" déclenchée par des ops étrangères d'autres bases du replica set.
# Sans oplog, les rares curseurs non gérés par les change streams (observeChanges
# ordonnés, curseurs skip/limit) retombent sur le polling au lieu de l'oplog.

export MONGO_URL
export QDRANT_URL="http://localhost:${QDRANT_TUNNEL_PORT}"
export PANORAMA_FILES_URL="https://panorama.mickaelfm.me"
export PANORAMA_FILES_API_KEY="${PANORAMA_FILES_API_KEY:?Définir PANORAMA_FILES_API_KEY dans ~/.env.secrets}"
MAIL_USER="${PANORAMA_MAIL_USER:-}"
MAIL_PASS="${PANORAMA_MAIL_PASS:-}"
if [ -n "$MAIL_USER" ] && [ -n "$MAIL_PASS" ]; then
  export MAIL_URL="smtp://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$MAIL_USER', safe=''))"):$(python3 -c "import urllib.parse; print(urllib.parse.quote('$MAIL_PASS', safe=''))")@mail.mickaelfm.me:587"
fi

# The Meteor tool process is hard-capped at --max-old-space-size=4096 in the
# launcher (~/.meteor/meteor). On 2026-07-18 it hit that 4 GB ceiling after a
# long dev session and OOM-crashed, killing the whole tree (Electron + MCP).
# TOOL_NODE_FLAGS is appended after the built-in flag, and Node applies the last
# duplicate flag, so this overrides the cap to 8 GB. Only widens the ceiling —
# if a real memory leak is confirmed, the root cause still needs fixing.
export TOOL_NODE_FLAGS="--max-old-space-size=8192"

echo "→ Lancement Electron (splash) + Meteor (port $METEOR_PORT)..."
echo "  MONGO_URL        = mongodb://${MONGO_USER}:***@${MONGO_HOST}/panorama?${MONGO_OPTS}"
echo "  reactivity       = Change Streams (Mongo 6 ; oplog désactivé)"
echo "  QDRANT_URL       = $QDRANT_URL"

# Job control ON : chaque commande lancée en `&` ci-dessous devient le leader
# de son PROPRE process group (son PGID == le PID rapporté par $!). C'est la clé
# du cleanup fiable : on tue ensuite le groupe entier d'un coup (npm → meteor →
# node app → workers rspack), là où l'ancien `pgrep -P` snapshot ratait la
# descendance de npm et laissait Meteor orphelin après Ctrl+C.
set -m

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

# Les deux process groups sont créés ; on coupe le monitor mode (évite les
# notifications de jobs) — les groupes déjà établis persistent.
set +m

# Le cleanup ci-dessous tue chaque process group en entier via `kill -SIG -PGID`
# (PID négatif = tout le groupe). Grâce à `set -m`, le leader du groupe == le PID
# capturé dans $!, donc on frappe npm, meteor, node app et les workers rspack d'un
# coup — sans toucher une autre instance Meteor lancée hors de ces groupes
# (ex: un `meteor test` en parallèle, qui a son propre groupe).

# --- INSTRUMENTATION TEMPORAIRE (à retirer après diagnostic) ---
QLOG=/tmp/panorama-quit.log
qlog() { echo "$(date '+%H:%M:%S') $*" | tee -a "$QLOG"; }
: > "$QLOG"
qlog "START electron=$ELECTRON_PID meteor=$METEOR_PID (pid script=$$)"

# Quoi qu'il arrive (quit Electron, Ctrl+C, arrêt de Meteor) → tout s'arrête.
cleanup() {
  trap - EXIT INT TERM
  qlog "CLEANUP electron alive=$(kill -0 "$ELECTRON_PID" 2>/dev/null && echo yes || echo no) meteor alive=$(kill -0 "$METEOR_PID" 2>/dev/null && echo yes || echo no)"
  # SIGTERM aux deux groupes entiers (PID négatif = le groupe ; leader==PID via set -m)
  kill -TERM -"$ELECTRON_PID" 2>/dev/null
  kill -TERM -"$METEOR_PID" 2>/dev/null
  sleep 2
  # SIGKILL pour achever tout récalcitrant (workers rspack qui traînent, etc.)
  kill -KILL -"$ELECTRON_PID" 2>/dev/null
  kill -KILL -"$METEOR_PID" 2>/dev/null
  qlog "CLEANUP done"
}
trap cleanup EXIT INT TERM

# --- Watchdog de reprise ---
#
# Pourquoi ici et pas dans le serveur : quand le serveur Meteor meurt (typiquement
# un démarrage pendant que le Wi-Fi est coupé — le driver Mongo ferme la topology,
# la création d'index de la collection `users` par accounts-base échoue et tue le
# process), l'outil meteor n'essaie PAS de relancer. Il passe en mode error page et
# attend un changement de fichier. Rien de ce qui tourne dans le process mort ne
# peut réparer ça : la reprise doit venir de l'extérieur, d'ici.
#
# Le déclencheur est un état observable, pas une forme d'erreur particulière : le
# proxy de dev (meteor-tool/tools/runners/run-proxy.js, showErrorPage) sert en 200
# une page qui contient le log du serveur, où figure la ligne « Your application is
# crashing » (run-app.js). On ne relance que si Mongo répond — relancer sur un
# réseau encore coupé rejoue exactement le crash.
#
# La relance se fait en réécrivant server/devRestartTrigger.js : le watcher de
# meteor voit le hash changer, rebuild et relance. Même mécanisme (et même ligne
# marqueur) que server/wakeRecovery.js, pour que les deux écrivains restent
# idempotents sur ce fichier.
WATCHDOG_CHECK_EVERY_S=5    # cadence des sondes HTTP
WATCHDOG_GRACE_S=20         # durée d'erreur continue avant d'agir
WATCHDOG_COOLDOWN_S=180     # attente minimale entre deux relances (rebuild + boot)
WATCHDOG_MAX_RESTARTS=3     # au-delà sans retour à la normale, on arrête d'insister
TRIGGER_FILE="$(dirname "$0")/server/devRestartTrigger.js"

# healthy : l'app sert ses pages · crashed : le serveur est mort, meteor attend
# un changement de fichier · error : page d'erreur sans crash serveur (erreur de
# build : relancer ne servirait à rien) · unknown : rebuild en cours (le proxy
# retient la connexion) ou port fermé — dans ce cas on ne conclut rien.
app_state() {
  body=$(curl -s --max-time 5 "http://127.0.0.1:${METEOR_PORT}/" 2>/dev/null) || { echo unknown; return; }
  case "$body" in
    "") echo unknown ;;
    *"Your application is crashing"*) echo crashed ;;
    *"Meteor App - Error"*) echo error ;;
    *) echo healthy ;;
  esac
}

# Attention a la portee : depuis que Mongo passe par un tunnel, ce test dit que
# le TUNNEL est debout, pas que mongod repond. Ca reste le bon signal pour ce
# watchdog, dont la question est « le reseau est-il revenu ? ».
mongo_is_reachable() {
  nc -z -G 3 "${MONGO_HOST%%:*}" "${MONGO_HOST##*:}" >/dev/null 2>&1
}

# Réécrit la ligne marqueur (au lieu de l'ajouter) pour que le fichier ne grossisse pas.
# Le fichier temporaire vit hors de l'arbre source : un fichier qui apparaît puis
# disparaît dans server/ serait vu par le watcher de meteor.
TRIGGER_TMP="${TMPDIR:-/tmp}/panorama-devRestartTrigger.$$"
touch_restart_trigger() {
  grep -v '^// last wake-recovery restart:' "$TRIGGER_FILE" > "$TRIGGER_TMP" \
    && printf '// last wake-recovery restart: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$TRIGGER_TMP" \
    && cat "$TRIGGER_TMP" > "$TRIGGER_FILE" \
    && rm -f "$TRIGGER_TMP"
}

crash_seconds=0
restart_count=0
last_restart_epoch=0
last_wait_log_epoch=0
tick=0

# Attendre que l'un des deux se termine ; le trap EXIT tue alors l'autre.
# (compatible bash 3.2 et zsh — pas de `wait -n`)
while kill -0 "$ELECTRON_PID" 2>/dev/null && kill -0 "$METEOR_PID" 2>/dev/null; do
  sleep 1
  tick=$((tick + 1))
  [ $((tick % WATCHDOG_CHECK_EVERY_S)) -eq 0 ] || continue

  state=$(app_state)
  if [ "$state" = "healthy" ]; then
    # Retour à la normale : on repart d'une ardoise vierge, y compris le quota.
    if [ "$restart_count" -gt 0 ] || [ "$crash_seconds" -gt 0 ]; then
      echo "[watchdog] l'app répond de nouveau."
    fi
    crash_seconds=0
    restart_count=0
    continue
  fi
  if [ "$state" != "crashed" ]; then
    crash_seconds=0
    continue
  fi

  crash_seconds=$((crash_seconds + WATCHDOG_CHECK_EVERY_S))
  [ "$crash_seconds" -ge "$WATCHDOG_GRACE_S" ] || continue

  now=$(date +%s)
  [ $((now - last_restart_epoch)) -ge "$WATCHDOG_COOLDOWN_S" ] || continue

  if [ "$restart_count" -ge "$WATCHDOG_MAX_RESTARTS" ]; then
    echo "[watchdog] serveur toujours mort après $WATCHDOG_MAX_RESTARTS relances — j'arrête d'insister, la cause n'est pas le réseau."
    last_restart_epoch=$now
    continue
  fi

  if ! mongo_is_reachable; then
    # Une nuit sans réseau ne doit pas noyer le terminal : une ligne par minute.
    if [ $((now - last_wait_log_epoch)) -ge 60 ]; then
      last_wait_log_epoch=$now
      echo "[watchdog] serveur mort mais Mongo ($MONGO_HOST) injoignable — j'attends le réseau."
    fi
    crash_seconds=0
    continue
  fi

  restart_count=$((restart_count + 1))
  if touch_restart_trigger; then
    echo "[watchdog] serveur mort depuis ${crash_seconds}s et Mongo répond — relance ($restart_count/$WATCHDOG_MAX_RESTARTS) via $TRIGGER_FILE"
  else
    echo "[watchdog] échec de réécriture de $TRIGGER_FILE — relance impossible."
  fi
  last_restart_epoch=$now
  crash_seconds=0
done
qlog "LOOP EXIT electron alive=$(kill -0 "$ELECTRON_PID" 2>/dev/null && echo yes || echo no) meteor alive=$(kill -0 "$METEOR_PID" 2>/dev/null && echo yes || echo no)"
