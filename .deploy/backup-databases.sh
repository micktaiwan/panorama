#!/usr/bin/env bash
# Daily backup of every database on the VPS: MongoDB and Qdrant.
# organizer-mongodb: shared instance — every app DB is enumerated dynamically
#   (all databases except admin/config/local), so new apps are covered automatically.
# nightscout: lives in its own nightscout-mongo container (creds from its .env).
# organizer-qdrant: the vector store. NOT optional and NOT a cache — the Eko
#   agent's memory, goals and self-model live only there (organizer_memory,
#   organizer_goals, organizer_self), as does Panorama's semantic index. Nothing
#   in Mongo duplicates it, so leaving it out meant one disk failure away from
#   losing it. Added 15/08/2026, after noticing exactly that.
#
# Cron: /etc/cron.d/backup-databases
#   0 2 * * * root /usr/local/bin/backup-databases.sh >> /var/log/backup-databases.log 2>&1
set -euo pipefail

BACKUP_DIR="/opt/backups"
RETENTION_DAYS=7
CONTAINER="organizer-mongodb"
MONGO_USER="admin"
MONGO_PASS="5c39e925fa50756aa89ee448e54e2535"
DATE=$(date +%Y-%m-%d)

mkdir -p "$BACKUP_DIR"

# --- organizer-mongodb (shared instance: back up every app DB) ---
# Enumerate all databases except the internal ones (admin/config/local).
DBS=$(docker exec "$CONTAINER" mongosh --quiet \
  -u "$MONGO_USER" -p "$MONGO_PASS" --authenticationDatabase admin \
  --eval 'db.adminCommand({listDatabases:1}).databases.forEach(function(d){if(["admin","config","local"].indexOf(d.name)<0)print(d.name)})')

for DB in $DBS; do
  OUT="$BACKUP_DIR/${DB}-${DATE}.gz"
  echo "[$(date -Iseconds)] Backing up $DB"
  docker exec "$CONTAINER" mongodump \
    --db "$DB" \
    -u "$MONGO_USER" \
    -p "$MONGO_PASS" \
    --authenticationDatabase admin \
    --gzip \
    --archive \
    2>/dev/null > "$OUT"
  SIZE=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")
  echo "[$(date -Iseconds)] $DB done ($(( SIZE / 1024 )) KB)"
done

# --- Nightscout (separate container, own credentials from its .env) ---
NS_ENV="/var/www/nightscout/.env"
NS_CONTAINER="nightscout-mongo"
NS_DB="nightscout"
if [ -f "$NS_ENV" ]; then
  NS_USER=$(grep '^MONGO_ROOT_USER=' "$NS_ENV" | cut -d= -f2-)
  NS_PASS=$(grep '^MONGO_ROOT_PASSWORD=' "$NS_ENV" | cut -d= -f2-)
  OUT="$BACKUP_DIR/nightscout-${DATE}.gz"
  echo "[$(date -Iseconds)] Backing up nightscout"
  docker exec "$NS_CONTAINER" mongodump \
    --db "$NS_DB" \
    -u "$NS_USER" \
    -p "$NS_PASS" \
    --authenticationDatabase admin \
    --gzip \
    --archive \
    2>/dev/null > "$OUT"
  SIZE=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")
  echo "[$(date -Iseconds)] nightscout done ($(( SIZE / 1024 )) KB)"
else
  echo "[$(date -Iseconds)] WARN: $NS_ENV not found, skipping nightscout backup"
fi

# --- Qdrant (vector store, one snapshot per collection) ---
# The host reaches Qdrant on 127.0.0.1:6333 (published loopback-only). The
# container image ships no curl and no tar, so the snapshot is created over HTTP,
# lifted out with `docker cp`, then deleted inside the container — otherwise
# /qdrant/snapshots grows without bound on the data volume itself.
#
# Deliberately not fatal: a Qdrant hiccup must not cost us the purge below, nor
# report failure on Mongo dumps that already succeeded.
QDRANT_URL="http://127.0.0.1:6333"
QDRANT_CONTAINER="organizer-qdrant"
QDRANT_FAILED=0

COLLECTIONS=$(curl -s -m 30 "$QDRANT_URL/collections" \
  | python3 -c 'import sys,json; print(" ".join(c["name"] for c in json.load(sys.stdin)["result"]["collections"]))' 2>/dev/null) || COLLECTIONS=""

if [ -z "$COLLECTIONS" ]; then
  echo "[$(date -Iseconds)] WARN: no Qdrant collection listed, skipping vector backup"
  QDRANT_FAILED=1
else
  for COL in $COLLECTIONS; do
    echo "[$(date -Iseconds)] Snapshotting $COL"
    SNAP=$(curl -s -m 600 -X POST "$QDRANT_URL/collections/$COL/snapshots" \
      | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["name"])' 2>/dev/null) || SNAP=""
    if [ -z "$SNAP" ]; then
      echo "[$(date -Iseconds)] WARN: snapshot failed for $COL"
      QDRANT_FAILED=1
      continue
    fi
    OUT="$BACKUP_DIR/qdrant-${COL}-${DATE}.snapshot"
    if docker cp "$QDRANT_CONTAINER:/qdrant/snapshots/$COL/$SNAP" "$OUT" 2>/dev/null; then
      # docker cp keeps the source mode (0600 root), unlike the mongodumps which
      # are written through a shell redirect and land 0644. Without this the
      # off-machine copy, which rsyncs as the plain `ubuntu` user, fails on
      # permission denied and no vector backup ever leaves the server.
      chmod 644 "$OUT"
      SIZE=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")
      echo "[$(date -Iseconds)] $COL done ($(( SIZE / 1024 )) KB)"
    else
      echo "[$(date -Iseconds)] WARN: could not copy the snapshot of $COL out of the container"
      QDRANT_FAILED=1
    fi
    # Drop it inside the container whether or not the copy worked: a snapshot left
    # behind is dead weight on the very volume we are trying to protect.
    curl -s -m 60 -X DELETE "$QDRANT_URL/collections/$COL/snapshots/$SNAP" >/dev/null 2>&1 || true
  done
fi

# Purge old backups (Mongo dumps and Qdrant snapshots alike)
find "$BACKUP_DIR" \( -name "*.gz" -o -name "*.snapshot" \) -mtime +"$RETENTION_DAYS" -delete
REMAINING=$(find "$BACKUP_DIR" \( -name "*.gz" -o -name "*.snapshot" \) | wc -l)
echo "[$(date -Iseconds)] Cleanup done. $REMAINING backup files remaining."
[ "$QDRANT_FAILED" -eq 0 ] || echo "[$(date -Iseconds)] WARN: the Qdrant part was incomplete, see above"
