#!/bin/bash
# Lightweight local liveness check for nomad-eye-backend — defense in depth
# alongside the systemd MemoryMax cap on the service itself (which only
# catches memory-growth hangs, not a CPU-bound deadlock with flat memory).
#
# Only restarts on a true connection failure/timeout (curl returns empty or
# "000"), not on any real HTTP status — a 401/404 still proves the process is
# alive and answering. Requires two consecutive failures (~4 min apart via the
# timer) before restarting, so one slow request under momentary load doesn't
# trigger a false-positive restart.
set -u

STATE=/run/nomad-eye-healthcheck.fails
FAILS=$(cat "$STATE" 2>/dev/null || echo 0)

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8080/ 2>/dev/null)

if [ -z "$CODE" ] || [ "$CODE" = "000" ]; then
    FAILS=$((FAILS + 1))
    echo "$FAILS" > "$STATE"
    if [ "$FAILS" -ge 2 ]; then
        logger -t nomad-eye-healthcheck "Backend unresponsive for $FAILS consecutive checks — restarting"
        systemctl restart nomad-eye-backend.service
        echo 0 > "$STATE"
    fi
else
    echo 0 > "$STATE"
fi
