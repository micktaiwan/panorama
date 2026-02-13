#!/usr/bin/env bash
# Panorama startup script — runs entirely in WSL, no Docker needed.
# Starts Qdrant (binary) + Meteor, then opens the browser on Windows.
#
# Usage:
#   ./panorama-start.sh          # start all
#   ./panorama-start.sh stop     # stop all
#   ./panorama-start.sh status   # check status

QDRANT_BIN="$HOME/.local/bin/qdrant"
QDRANT_DIR="$HOME/.local/share/qdrant"
QDRANT_PORT=6333
QDRANT_LOG="/tmp/panorama-qdrant.log"
QDRANT_PID="/tmp/panorama-qdrant.pid"

METEOR_DIR="$HOME/www/3_boulot/panoramix/panorama"
METEOR_LOG="/tmp/panorama-meteor.log"
METEOR_PID="/tmp/panorama-meteor.pid"
METEOR_PORT=3000

# --- Functions ---

start_qdrant() {
    if [ -f "$QDRANT_PID" ] && kill -0 "$(cat "$QDRANT_PID")" 2>/dev/null; then
        echo "Qdrant already running (PID $(cat "$QDRANT_PID"))"
        return
    fi
    echo "Starting Qdrant..."
    mkdir -p "$QDRANT_DIR/storage"
    cd "$QDRANT_DIR" || exit 1
    nohup "$QDRANT_BIN" --disable-telemetry > "$QDRANT_LOG" 2>&1 < /dev/null &
    disown $!
    echo $! > "$QDRANT_PID"
    echo "Qdrant started (PID $!)"
    # Wait for Qdrant to be ready before starting Meteor
    echo "Waiting for Qdrant to be ready..."
    for i in $(seq 1 30); do
        if curl -s http://localhost:$QDRANT_PORT/healthz > /dev/null 2>&1; then
            echo "Qdrant is ready."
            return
        fi
        sleep 1
    done
    echo "Warning: Qdrant may not be ready yet."
}

start_meteor() {
    if [ -f "$METEOR_PID" ] && kill -0 "$(cat "$METEOR_PID")" 2>/dev/null; then
        echo "Meteor already running (PID $(cat "$METEOR_PID"))"
        return
    fi
    echo "Starting Meteor..."
    cd "$METEOR_DIR" || exit 1
    nohup "$HOME/.meteor/meteor" run --settings settings.json > "$METEOR_LOG" 2>&1 < /dev/null &
    disown $!
    echo $! > "$METEOR_PID"
    echo "Meteor started (PID $!)"
}

wait_and_open_browser() {
    echo "Waiting for Meteor on port $METEOR_PORT..."
    for i in $(seq 1 60); do
        if curl -s -o /dev/null -w '' "http://localhost:$METEOR_PORT" 2>/dev/null; then
            echo "Meteor is ready. Opening browser..."
            cmd.exe /c start "http://localhost:$METEOR_PORT" 2>/dev/null
            return
        fi
        sleep 5
    done
    echo "Meteor did not start in time. Opening browser anyway..."
    cmd.exe /c start "http://localhost:$METEOR_PORT" 2>/dev/null
}

stop_all() {
    echo "Stopping Meteor..."
    if [ -f "$METEOR_PID" ]; then
        kill -- -"$(cat "$METEOR_PID")" 2>/dev/null
        rm -f "$METEOR_PID"
    fi
    echo "Stopping Qdrant..."
    if [ -f "$QDRANT_PID" ]; then
        kill -- -"$(cat "$QDRANT_PID")" 2>/dev/null
        rm -f "$QDRANT_PID"
    fi
    echo "Stopped."
}

show_status() {
    echo "=== Qdrant ==="
    if [ -f "$QDRANT_PID" ] && kill -0 "$(cat "$QDRANT_PID")" 2>/dev/null; then
        echo "Running (PID $(cat "$QDRANT_PID"))"
    else
        echo "Not running"
    fi
    echo "=== Meteor ==="
    if [ -f "$METEOR_PID" ] && kill -0 "$(cat "$METEOR_PID")" 2>/dev/null; then
        echo "Running (PID $(cat "$METEOR_PID"))"
    else
        echo "Not running"
    fi
}

# --- Main ---

case "${1:-start}" in
    start)
        start_qdrant
        start_meteor
        wait_and_open_browser
        echo ""
        echo "========================================="
        echo "  Panorama is running on :$METEOR_PORT"
        echo "========================================="
        echo ""
        echo "Commands: status | stop | logs | quit"
        echo ""
        while true; do
            read -rp "> " cmd
            case "$cmd" in
                stop)
                    stop_all
                    echo "Bye!"
                    exit 0
                    ;;
                status)
                    show_status
                    ;;
                logs)
                    tail -20 "$METEOR_LOG"
                    ;;
                quit|exit)
                    echo "Services still running in background. Use 'stop' to stop them."
                    exit 0
                    ;;
                *)
                    echo "Commands: status | stop | logs | quit"
                    ;;
            esac
        done
        ;;
    launch)
        start_qdrant
        start_meteor
        echo "Services started."
        ;;
    stop)
        stop_all
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 {start|stop|status|launch}"
        exit 1
        ;;
esac
