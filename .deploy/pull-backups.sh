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

# The dumps are chowned to ubuntu (0600) by backup-databases.sh, so rsync takes
# them as the plain ubuntu user -- no sudo, no remote tar. The nested
# panorama/ directory (dev dumps pushed up by backup.sh) is excluded: pulling
# back what this Mac just sent would be pointless traffic.
#
# history/ and launchd.log live inside LOCAL_DIR but not on the server, so
# --delete would wipe them on every run unless excluded (it did: only one day of
# history survived until 2026-10-05). --max-delete caps the damage if the server
# side ever comes back empty: a normal day rotates out ~20 files.
rsync -az --delete --max-delete=60 --timeout=120 \
  --exclude 'panorama/' \
  --exclude 'history/' \
  --exclude 'launchd.log' \
  -e "ssh -o BatchMode=yes -o ConnectTimeout=20" \
  "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/" "$LOCAL_DIR/" \
  || fail "rsync from $SERVER_HOST"

COUNT=$(find "$LOCAL_DIR" -maxdepth 1 \( -name '*.gz' -o -name '*.snapshot' \) | wc -l | tr -d ' ')
[ "$COUNT" -gt 0 ] || fail "no dump pulled"

# --delete keeps the local copy in sync with the server, which would cap history
# at the server's own 7 days. history/ keeps every dump that ever came down,
# flat, copied once (cp -n): no day is lost when the Mac sleeps through a run
# (the server still holds 7 days to catch up from), and nothing is stored
# twice. Each file keeps the server mtime (rsync -a, cp -p), so retention is
# per file. Until 2026-10-05 history/ held dated folders that each re-copied
# the whole 7-day window; those folders age out below like any old file.
KEEP_DIR="$LOCAL_DIR/history"
mkdir -p "$KEEP_DIR"
find "$LOCAL_DIR" -maxdepth 1 \( -name '*.gz' -o -name '*.snapshot' \) -exec cp -pn {} "$KEEP_DIR/" \;

find "$KEEP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete 2>/dev/null
find "$KEEP_DIR" -mindepth 1 -type d -empty -delete 2>/dev/null

SIZE=$(du -sh "$LOCAL_DIR" | cut -f1)
DAYS=$(find "$KEEP_DIR" -type f \( -name '*.gz' -o -name '*.snapshot' \) | sed -E 's/.*([0-9]{4}-[0-9]{2}-[0-9]{2}).*/\1/' | sort -u | wc -l | tr -d ' ')
echo "[$(date -Iseconds)] OK: $COUNT dumps, $DAYS days kept, $SIZE total"
notify "OK: $COUNT dumps, $DAYS jours, $SIZE"
