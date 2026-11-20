#!/bin/bash
# Shared settings for the QueuePass demo scripts. Sourced by every .command file in this folder.
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="queuepass-team"            # the Docker Compose project (your team stack)
DB_CONTAINER="$PROJECT-database-1"
BACKEND_CONTAINER="$PROJECT-backend-1"
DB_USER="queuepass"
DB_NAME="queuepass"
SNAPSHOT="$HERE/snapshots/demo-snapshot.dump"
PREVIOUS="$HERE/snapshots/demo-snapshot.previous.dump"
BEFORE_RESET_DB="${DB_NAME}_before_reset"   # the data as it was before the last reset (for Undo)
INCOMING_DB="${DB_NAME}_incoming"
APPS=(http://localhost:5173 http://localhost:5174 http://localhost:5175)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mERROR: %s\033[0m\n' "$*"; pause_and_exit 1; }
pause_and_exit() { printf '\nPress Enter to close this window.'; read -r _ || true; exit "${1:-0}"; }

# psql on the server's "postgres" database. With arguments (-c "…") it reads nothing from the
# keyboard; with none it reads SQL from a heredoc. (docker exec -i would swallow a keypress.)
psql_admin() {
  local env=(-e PGOPTIONS="-c client_min_messages=warning")
  local args=(psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres -Atq)
  if [ $# -gt 0 ]; then
    docker exec "${env[@]}" "$DB_CONTAINER" "${args[@]}" "$@" </dev/null
  else
    docker exec -i "${env[@]}" "$DB_CONTAINER" "${args[@]}"
  fi
}

need_docker() {
  docker info >/dev/null 2>&1 || fail "Docker isn't running. Open Docker Desktop, wait for it to start, and try again."
  docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || fail "No container $DB_CONTAINER. Is the team stack set up?"
  if [ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER")" != "true" ]; then
    say "Starting the database…"
    docker start "$DB_CONTAINER" >/dev/null
  fi
  for _ in $(seq 1 60); do
    docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1 && return 0
    sleep 1
  done
  fail "The database didn't become ready."
}

wait_healthy() { # container, seconds
  local c="$1" limit="${2:-180}" status
  for _ in $(seq 1 "$limit"); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo missing)"
    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then return 0; fi
    sleep 1
  done
  return 1
}

# A one-line summary of what the data holds, to compare before and after.
summary() { # database name
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$1" -Atc \
    "select (select count(*) from \"Location\") || ' venues, ' || (select count(*) from \"Event\") || ' events, ' || (select count(*) from \"Order\") || ' orders, ' || (select count(*) from \"Ticket\") || ' tickets'" 2>/dev/null || echo "(could not read)"
}

# The venue "4 Clear events and venues" keeps, by its exact name.
KEEP_VENUE="KFC Yum! Center"

# SQL that deletes every event (with its orders, tickets, holds, prices and images) and every
# venue but KEEP_VENUE (with its layouts), all or nothing.
clear_sql() {
  local keep="${KEEP_VENUE//\'/\'\'}"
  cat <<SQL
BEGIN;
DO \$\$ BEGIN
  IF (SELECT count(*) FROM "Location" WHERE name = '$keep') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one venue named "$keep"; nothing was deleted.';
  END IF;
END \$\$;
DELETE FROM "Ticket";
DELETE FROM "Order";
DELETE FROM "Event";
DELETE FROM "Location" WHERE name <> '$keep';
COMMIT;
SQL
}
