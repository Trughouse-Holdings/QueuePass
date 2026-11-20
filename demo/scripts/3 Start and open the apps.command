#!/bin/bash
# Starts the team stack if it isn't running, waits for it, and opens the three apps.
source "$(dirname "$0")/common.sh"

docker info >/dev/null 2>&1 || fail "Docker isn't running. Open Docker Desktop, wait for it to start, and try again."
containers=$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}}')
[ -n "$containers" ] || fail "No containers for the $PROJECT stack."
say "Starting the QueuePass stack (anything already running is left alone)…"
for c in $containers; do
  case "$c" in *seed*) continue ;; esac   # the seed runs once at setup; never again
  [ "$(docker inspect -f '{{.State.Running}}' "$c")" = "true" ] || docker start "$c" >/dev/null
done
say "Waiting for the apps…"
for c in $containers; do
  case "$c" in *seed*) continue ;; esac
  wait_healthy "$c" 180 || fail "$c didn't become healthy."
done
for url in "${APPS[@]}"; do
  curl -fsS -o /dev/null "$url" || fail "$url isn't answering."
done
open "${APPS[@]}"
say "Open: Admin (5173, admin1), Customer (5174, customer1), Ticket Booth (5175, agent1)."
pause_and_exit 0
