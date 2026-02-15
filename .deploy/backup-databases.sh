#!/usr/bin/env bash
# Daily backup of organizer and panorama MongoDB databases.
# Runs mongodump inside the organizer-mongodb container.
# Replaces the old backup-organizer.sh (single DB only).
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

for DB in organizer panorama; do
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

# Purge old backups (both naming conventions)
find "$BACKUP_DIR" -name "*.gz" -mtime +"$RETENTION_DAYS" -delete
REMAINING=$(find "$BACKUP_DIR" -name "*.gz" | wc -l)
echo "[$(date -Iseconds)] Cleanup done. $REMAINING backup files remaining."
