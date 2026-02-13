#!/bin/bash
set -e

# Configuration
SERVER="ubuntu@51.210.150.25"
BACKUP_DIR="/opt/backups/panoramix"
LOCAL_BACKUP_DIR="${HOME}/backups/panoramix"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7

echo "=== Panoramix — Backup MongoDB ==="

# Créer le dossier local
mkdir -p "$LOCAL_BACKUP_DIR"

# Dump sur le serveur
echo "[1/3] Dump MongoDB sur le serveur..."
ssh $SERVER << EOF
  sudo mkdir -p $BACKUP_DIR
  sudo docker exec organizer-mongodb mongodump --db panoramix --archive=/data/db/panoramix_${DATE}.archive --gzip
  sudo docker cp organizer-mongodb:/data/db/panoramix_${DATE}.archive $BACKUP_DIR/panoramix_${DATE}.archive
  sudo docker exec organizer-mongodb rm -f /data/db/panoramix_${DATE}.archive
  echo "  Dump: $BACKUP_DIR/panoramix_${DATE}.archive"
EOF

# Télécharger
echo "[2/3] Téléchargement du backup..."
scp $SERVER:$BACKUP_DIR/panoramix_${DATE}.archive "$LOCAL_BACKUP_DIR/"
echo "  Local: $LOCAL_BACKUP_DIR/panoramix_${DATE}.archive"

# Rotation (supprimer les vieux backups)
echo "[3/3] Rotation (${RETENTION_DAYS}j)..."
find "$LOCAL_BACKUP_DIR" -name "panoramix_*.archive" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true
ssh $SERVER "sudo find $BACKUP_DIR -name 'panoramix_*.archive' -mtime +$RETENTION_DAYS -delete" 2>/dev/null || true

LOCAL_COUNT=$(ls "$LOCAL_BACKUP_DIR"/panoramix_*.archive 2>/dev/null | wc -l)
echo "  Backups locaux: $LOCAL_COUNT"

echo "=== Backup terminé ==="
