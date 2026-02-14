#!/bin/bash
# Backup Panorama MongoDB (local) to OVH server
# Works whether Meteor is running or not
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

notify() {
  osascript -e "display notification \"$1\" with title \"Panorama Backup\""
}
trap 'notify "FAILED - check launchd.log"; exit 1' ERR

# Load server config
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/server-ovh.local"

# Config
LOCAL_PORT=4001
TEMP_PORT=4002
DB_DIR="$SCRIPT_DIR/.meteor/local/db"
DB_NAME="meteor"
LOCAL_BACKUP_DIR="$SCRIPT_DIR/.backups"
REMOTE_BACKUP_DIR="/opt/backups/panorama"
RETENTION_DAYS=7
DATE=$(date +%Y-%m-%d_%H%M)
FILENAME="panorama_${DATE}.gz"
STARTED_MONGOD=false

# Use Meteor's bundled mongod (same version that created the DB)
METEOR_MONGOD=$(find "$HOME/.meteor/packages/meteor-tool" -name "mongod" -path "*/bin/mongod" -type f 2>/dev/null | sort | tail -1)
if [ -z "$METEOR_MONGOD" ]; then
  echo "Error: Meteor mongod not found. Using system mongod."
  METEOR_MONGOD="mongod"
fi

mkdir -p "$LOCAL_BACKUP_DIR"

# Check if Meteor's MongoDB is already running
if mongosh --quiet --port $LOCAL_PORT --eval "db.runCommand({ping:1})" &>/dev/null; then
  echo "Meteor MongoDB already running on port $LOCAL_PORT"
else
  # Start a temporary mongod using Meteor's version
  LOCAL_PORT=$TEMP_PORT
  echo "Meteor not running. Starting temporary mongod on port $LOCAL_PORT..."
  "$METEOR_MONGOD" --dbpath "$DB_DIR" --port $LOCAL_PORT --bind_ip 127.0.0.1 &>/dev/null &
  MONGOD_PID=$!
  STARTED_MONGOD=true
  # Wait for mongod to be ready
  for i in $(seq 1 15); do
    if mongosh --quiet --port $LOCAL_PORT --eval "db.runCommand({ping:1})" &>/dev/null; then
      break
    fi
    sleep 1
  done
fi

cleanup() {
  if [ "$STARTED_MONGOD" = true ] && [ -n "${MONGOD_PID:-}" ]; then
    echo "Stopping temporary mongod..."
    kill $MONGOD_PID 2>/dev/null && wait $MONGOD_PID 2>/dev/null
  fi
}
trap cleanup EXIT

# 1. Dump
echo "Dumping MongoDB (localhost:$LOCAL_PORT/$DB_NAME)..."
mongodump --host=127.0.0.1 --port=$LOCAL_PORT --db=$DB_NAME --archive --gzip > "$LOCAL_BACKUP_DIR/$FILENAME"
SIZE=$(du -h "$LOCAL_BACKUP_DIR/$FILENAME" | cut -f1)
echo "Dump OK: $FILENAME ($SIZE)"

# 2. Upload to OVH
echo "Uploading to $SERVER_USER@$SERVER_HOST..."
ssh "$SERVER_USER@$SERVER_HOST" "sudo mkdir -p $REMOTE_BACKUP_DIR && sudo chown $SERVER_USER:$SERVER_USER $REMOTE_BACKUP_DIR"
scp "$LOCAL_BACKUP_DIR/$FILENAME" "$SERVER_USER@$SERVER_HOST:$REMOTE_BACKUP_DIR/$FILENAME"
echo "Upload OK"

# 3. Purge old backups (local + remote)
echo "Purging backups older than $RETENTION_DAYS days..."
find "$LOCAL_BACKUP_DIR" -name "panorama_*.gz" -mtime +$RETENTION_DAYS -delete
ssh "$SERVER_USER@$SERVER_HOST" "find $REMOTE_BACKUP_DIR -name 'panorama_*.gz' -mtime +$RETENTION_DAYS -delete"

notify "OK: $FILENAME ($SIZE)"
echo "Backup complete: $FILENAME ($SIZE)"
