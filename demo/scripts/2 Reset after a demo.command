#!/bin/bash
# Puts the team stack's data back to the saved snapshot: venues, events, orders, tickets, seat
# holds and check-ins made during the demo are gone. Sign-in accounts (Keycloak) are not touched.
#
# Safe by design: the snapshot is loaded into a separate database first; only when that worked
# is it swapped in (the Backend stops for a few seconds). The data from just before the reset is
# kept until the next reset, so "Undo the last reset" can bring it back.
source "$(dirname "$0")/common.sh"

[ -f "$SNAPSHOT" ] || fail "There is no snapshot yet. Run \"1 Save demo snapshot\" first, before the demo."
need_docker

say "Reset QueuePass to the demo snapshot"
echo "Now:      $(summary "$DB_NAME")"
echo "Snapshot: saved $(date -r "$SNAPSHOT" '+%a %b %-d, %-I:%M %p')"
printf '\nPress Enter to reset, or close this window to cancel. '
read -r _

say "1/4 Loading the snapshot into a separate database…"
psql_admin -c "DROP DATABASE IF EXISTS \"$INCOMING_DB\";"
psql_admin -c "CREATE DATABASE \"$INCOMING_DB\" OWNER \"$DB_USER\" TEMPLATE template0;"
if ! docker exec -i "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$INCOMING_DB" --no-owner --exit-on-error < "$SNAPSHOT"; then
  psql_admin -c "DROP DATABASE IF EXISTS \"$INCOMING_DB\";" || true
  fail "The snapshot could not be loaded. Nothing was changed."
fi
echo "Loaded: $(summary "$INCOMING_DB")"

say "2/4 Stopping the Backend for a moment…"
docker stop "$BACKEND_CONTAINER" >/dev/null

say "3/4 Swapping in the snapshot…"
if ! psql_admin >/dev/null <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$DB_NAME', '$INCOMING_DB') AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "$BEFORE_RESET_DB";
BEGIN;
ALTER DATABASE "$DB_NAME" RENAME TO "$BEFORE_RESET_DB";
ALTER DATABASE "$INCOMING_DB" RENAME TO "$DB_NAME";
COMMIT;
SQL
then
  docker start "$BACKEND_CONTAINER" >/dev/null
  fail "The swap failed (the renames are all or nothing); the Backend was restarted on the data it had."
fi

say "4/4 Starting the Backend…"
docker start "$BACKEND_CONTAINER" >/dev/null
if wait_healthy "$BACKEND_CONTAINER" 180; then
  say "Done. QueuePass is back to the demo snapshot: $(summary "$DB_NAME")"
  echo "Reload the app tabs in the browser. (If an app asks you to sign in again, that's expected.)"
else
  fail "The Backend didn't come back healthy. Try \"3 Start and open the apps\", or \"Undo the last reset\"."
fi
pause_and_exit 0
