#!/usr/bin/env bash
# Daily backup of all MongoDB databases on the VPS.
# organizer-mongodb: shared instance — every app DB is enumerated dynamically
#   (all databases except admin/config/local), so new apps are covered automatically.
# nightscout: lives in its own nightscout-mongo container (creds from its .env).
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

# Purge old backups (covers every ${DB}-*.gz and nightscout-*.gz)
find "$BACKUP_DIR" -name "*.gz" -mtime +"$RETENTION_DAYS" -delete
REMAINING=$(find "$BACKUP_DIR" -name "*.gz" | wc -l)
echo "[$(date -Iseconds)] Cleanup done. $REMAINING backup files remaining."
