#!/bin/sh
set -e

# Fix ownership of mounted volumes (they may be owned by root)
if [ "$(id -u)" = "0" ]; then
    chown -R appuser:appgroup /app/public 2>/dev/null || true
    chown -R appuser:appgroup /app/logs 2>/dev/null || true
    exec su-exec appuser "$@"
fi

exec "$@"
