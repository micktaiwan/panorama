#!/usr/bin/env bash
# Daily backup of every database on the VPS: MongoDB, Qdrant and SQLite.
# organizer-mongodb: shared instance — every app DB is enumerated dynamically
#   (all databases except admin/config/local), so new apps are covered automatically.
# nightscout: lives in its own nightscout-mongo container (creds from its .env).
# organizer-qdrant: the vector store. NOT optional and NOT a cache — the Eko
#   agent's memory, goals and self-model live only there (organizer_memory,
#   organizer_goals, organizer_self), as does Panorama's semantic index. Nothing
#   in Mongo duplicates it, so leaving it out meant one disk failure away from
#   losing it. Added 15/08/2026, after noticing exactly that.
# pharos: the HTTP event log, a SQLite file. Added 16/08/2026 — it was outside this script by
#   construction, since everything above enumerates Mongo databases and would never see a file.
#
# Cron: /etc/cron.d/backup-databases
#   0 2 * * * root /usr/local/bin/backup-databases.sh 2>&1 | tee -a /var/log/backup-databases.log | systemd-cat -t backup-databases
set -euo pipefail

BACKUP_DIR="/opt/backups"
RETENTION_DAYS=7
CONTAINER="organizer-mongodb"
MONGO_USER="admin"
. /root/.backup-mongo.env  # MONGO_PASS lives there (0600), not in this script
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

COLLECTIONS=$(curl -s -H "api-key: ${QDRANT_API_KEY:-}" -m 30 "$QDRANT_URL/collections" \
  | python3 -c 'import sys,json; print(" ".join(c["name"] for c in json.load(sys.stdin)["result"]["collections"]))' 2>/dev/null) || COLLECTIONS=""

if [ -z "$COLLECTIONS" ]; then
  echo "[$(date -Iseconds)] WARN: no Qdrant collection listed, skipping vector backup"
  QDRANT_FAILED=1
else
  for COL in $COLLECTIONS; do
    echo "[$(date -Iseconds)] Snapshotting $COL"
    SNAP=$(curl -s -H "api-key: ${QDRANT_API_KEY:-}" -m 600 -X POST "$QDRANT_URL/collections/$COL/snapshots" \
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
      chown ubuntu:ubuntu "$OUT"; chmod 600 "$OUT"
      SIZE=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")
      echo "[$(date -Iseconds)] $COL done ($(( SIZE / 1024 )) KB)"
    else
      echo "[$(date -Iseconds)] WARN: could not copy the snapshot of $COL out of the container"
      QDRANT_FAILED=1
    fi
    # Drop it inside the container whether or not the copy worked: a snapshot left
    # behind is dead weight on the very volume we are trying to protect.
    curl -s -H "api-key: ${QDRANT_API_KEY:-}" -m 60 -X DELETE "$QDRANT_URL/collections/$COL/snapshots/$SNAP" >/dev/null 2>&1 || true
  done
fi

# --- Pharos (SQLite: the HTTP event log of every request crossing mup-nginx-proxy) ---
# Deliberately NOT a `cp`. The store runs in WAL mode with the server writing into it, so the .db
# on disk is missing whatever is still in pharos.db-wal — measured at 4 MB of WAL against a 2 MB
# database. A plain copy is a torn read: a file that opens fine and is quietly short, which is the
# worst shape a backup can have because nothing reports it until the day it is needed.
#
# `pharos-server backup` runs SQLite's VACUUM INTO inside a read transaction, so it writes one
# coherent, compacted, self-contained file with no -wal beside it. It also means this host needs no
# sqlite3 binary: the process that owns the database is the one that copies it.
#
# Deliberately not fatal, like Qdrant above: a Pharos hiccup must not cost us the purge below.
PHAROS_DATA="/opt/pharos/data"
PHAROS_TMP="$PHAROS_DATA/backup-${DATE}.db"
if docker ps --format '{{.Names}}' | grep -qx pharos; then
  echo "[$(date -Iseconds)] Backing up pharos"
  # The backup command refuses to overwrite, on purpose. Clearing the temp file first is what makes
  # a second run on the same day work rather than fail.
  rm -f "$PHAROS_TMP"
  if docker exec pharos /usr/local/bin/pharos-server \
       --db /var/lib/pharos/pharos.db \
       backup --to "/var/lib/pharos/backup-${DATE}.db" >/dev/null 2>&1 \
     && [ -s "$PHAROS_TMP" ]; then
    OUT="$BACKUP_DIR/pharos-${DATE}.db.gz"
    gzip -c "$PHAROS_TMP" > "$OUT"
    chown ubuntu:ubuntu "$OUT"; chmod 600 "$OUT"
    SIZE=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")
    echo "[$(date -Iseconds)] pharos done ($(( SIZE / 1024 )) KB)"
  else
    echo "[$(date -Iseconds)] WARN: the pharos backup failed"
  fi
  rm -f "$PHAROS_TMP"
else
  echo "[$(date -Iseconds)] WARN: the pharos container is not running, skipping its backup"
fi

# --- Files that live outside any database (added 2026-10-05) ---
# Until then nothing copied them: the ASL corpus, Loc photos, Codraw blobs, the
# Trame SQLite and the mailboxes existed on this disk only. Archives are named
# *.gz so the purge below and the Mac pull (pull-backups.sh) pick them up as is.
# The ASL corpus is ~400 MB and mostly already-compressed PDFs and images, so it
# goes weekly (Sunday) instead of daily; the rest is small and goes every night.
backup_dir_tar() {  # <name> <directory>
  local name="$1" dir="$2" out="$BACKUP_DIR/files-$1-${DATE}.tar.gz"
  if [ ! -d "$dir" ]; then echo "[$(date -Iseconds)] WARN: $dir missing, skipping $name"; return; fi
  if tar -C "$(dirname "$dir")" -czf "$out" "$(basename "$dir")" 2>/dev/null; then
    chown ubuntu:ubuntu "$out"; chmod 600 "$out"
    echo "[$(date -Iseconds)] files $name done ($(( $(stat -c%s "$out") / 1024 )) KB)"
  else
    echo "[$(date -Iseconds)] WARN: tar failed for $name"; rm -f "$out"
  fi
}
backup_dir_tar loc /home/ubuntu/loc/data
backup_dir_tar codraw /home/ubuntu/codraw-data
backup_dir_tar mail-data /var/www/mailserver/mail-data
backup_dir_tar mail-state /var/www/mailserver/mail-state
[ "$(date +%u)" = "7" ] && backup_dir_tar asl /home/ubuntu/asl/data

# Trame is SQLite in WAL mode: a tar of the directory would be a torn read (see
# the Pharos note above). Python's sqlite3 backup API copies it consistently.
TRAME_DB=/home/ubuntu/trame/data/trame.db
if [ -f "$TRAME_DB" ]; then
  TRAME_TMP="$BACKUP_DIR/trame-${DATE}.db"
  if python3 -c "import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" "$TRAME_DB" "$TRAME_TMP" \
     && gzip -f "$TRAME_TMP"; then
    chown ubuntu:ubuntu "$TRAME_TMP.gz"; chmod 600 "$TRAME_TMP.gz"
    echo "[$(date -Iseconds)] trame done"
  else
    echo "[$(date -Iseconds)] WARN: trame backup failed"; rm -f "$TRAME_TMP" "$TRAME_TMP.gz"
  fi
fi

# Every file above is owner-only and owned by ubuntu, whatever wrote it: the
# mongodumps land through a shell redirect as root 0644, which this normalizes.
# ubuntu owns them so pull-backups.sh can rsync them without sudo.
find "$BACKUP_DIR" -type f \( -name "*.gz" -o -name "*.snapshot" \) -exec chown ubuntu:ubuntu {} + -exec chmod 600 {} +

# Purge old backups (Mongo dumps, Qdrant snapshots and the Pharos database alike:
# `pharos-<date>.db.gz` is matched by the *.gz pattern below, so it ages out with the rest)
find "$BACKUP_DIR" \( -name "*.gz" -o -name "*.snapshot" \) -mtime +"$RETENTION_DAYS" -delete
REMAINING=$(find "$BACKUP_DIR" \( -name "*.gz" -o -name "*.snapshot" \) | wc -l)
echo "[$(date -Iseconds)] Cleanup done. $REMAINING backup files remaining."
[ "$QDRANT_FAILED" -eq 0 ] || echo "[$(date -Iseconds)] WARN: the Qdrant part was incomplete, see above"
