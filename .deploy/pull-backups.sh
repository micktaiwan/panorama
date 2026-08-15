#!/bin/bash
# Pull the VPS database dumps down to the Mac.
#
# Counterpart of .deploy/backup-databases.sh, which runs ON the VPS at 02:00 and
# writes logical mongodump archives to /opt/backups. Those dumps sit on the same
# disk as the databases they protect, so they are worthless against losing the
# machine. This script is the missing half: it copies them off the server.
#
# It does NOT replace OVH's automated backup (whole-VM image, daily, 7-day
# rotation). That one covers "the machine is gone". These dumps cover "one
# database, one collection, one document went wrong" -- a 6 MB archive replays
# into a throwaway container in a minute, where a VM image has to be attached
# and mounted first.
#
# Two kinds of file come down: *.gz (mongodump archives) and *.snapshot (Qdrant,
# one per collection — that is where the Eko agent's memory actually lives).
#
# Local retention is deliberately longer than the server's: the point of holding
# a second copy is also to hold a longer history.
#
# Cron: launchd, ~/Library/LaunchAgents/com.panorama.pullbackups.plist (12:05)
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../server-ovh.local"

REMOTE_DIR="/opt/backups"
LOCAL_DIR="$HOME/Backups/vps-ovh"
RETENTION_DAYS=30

notify() { osascript -e "display notification \"$1\" with title \"VPS Backups\"" >/dev/null 2>&1; }
fail()   { echo "[$(date -Iseconds)] FAILED: $1"; notify "FAILED - $1"; exit 1; }

mkdir -p "$LOCAL_DIR"

echo "[$(date -Iseconds)] Pulling $SERVER_USER@$SERVER_HOST:$REMOTE_DIR"

# The dumps are written by root (0644), so they are world-readable and rsync can
# take them as the plain ubuntu user -- no sudo, no remote tar. The nested
# panorama/ directory (dev dumps pushed up by backup.sh) is excluded: pulling
# back what this Mac just sent would be pointless traffic.
rsync -az --delete --timeout=120 \
  --exclude 'panorama/' \
  -e "ssh -o BatchMode=yes -o ConnectTimeout=20" \
  "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/" "$LOCAL_DIR/" \
  || fail "rsync from $SERVER_HOST"

COUNT=$(find "$LOCAL_DIR" -maxdepth 1 \( -name '*.gz' -o -name '*.snapshot' \) | wc -l | tr -d ' ')
[ "$COUNT" -gt 0 ] || fail "no dump pulled"

# --delete keeps the local copy in sync with the server, which would cap history
# at the server's own 7 days. Snapshot the freshest set into a dated folder that
# rsync never touches, and let THAT accumulate.
KEEP_DIR="$LOCAL_DIR/history/$(date +%Y-%m-%d)"
mkdir -p "$KEEP_DIR"
find "$LOCAL_DIR" -maxdepth 1 \( -name '*.gz' -o -name '*.snapshot' \) -exec cp -p {} "$KEEP_DIR/" \;

find "$LOCAL_DIR/history" -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -exec rm -rf {} + 2>/dev/null

SIZE=$(du -sh "$LOCAL_DIR" | cut -f1)
DAYS=$(find "$LOCAL_DIR/history" -maxdepth 1 -type d -name '20*' | wc -l | tr -d ' ')
echo "[$(date -Iseconds)] OK: $COUNT dumps, $DAYS days kept, $SIZE total"
notify "OK: $COUNT dumps, $DAYS jours, $SIZE"
