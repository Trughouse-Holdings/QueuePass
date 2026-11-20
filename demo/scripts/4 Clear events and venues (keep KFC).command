#!/bin/bash
# Deletes every event (with its orders, tickets, seat holds and check-ins) and every venue except
# the KFC Yum! Center, which keeps its layouts. Sign-in accounts are not touched.
# "Undo the last reset" brings everything back.
source "$(dirname "$0")/common.sh"

need_docker
keep_id=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atc "SELECT count(*) FROM \"Location\" WHERE name = '${KEEP_VENUE//\'/\'\'}'")
[ "$keep_id" = "1" ] || fail "Expected exactly one venue named \"$KEEP_VENUE\"; found $keep_id. Nothing was changed."

say "Clear events and venues, keeping $KEEP_VENUE"
echo "Now: $(summary "$DB_NAME")"
echo
echo "Venues that will be deleted (with their layouts):"
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atc \
  "SELECT '  - ' || name FROM \"Location\" WHERE name <> '${KEEP_VENUE//\'/\'\'}' ORDER BY name"
echo "Every event will be deleted, $KEEP_VENUE's too, with all orders and tickets."
echo "$KEEP_VENUE and its layouts stay."
printf '\nPress Enter to clear, or close this window to cancel. '
read -r _

say "1/3 Stopping the Backend and keeping a copy for Undo…"
docker stop "$BACKEND_CONTAINER" >/dev/null
if ! psql_admin >/dev/null <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "$BEFORE_RESET_DB";
CREATE DATABASE "$BEFORE_RESET_DB" TEMPLATE "$DB_NAME";
SQL
then
  docker start "$BACKEND_CONTAINER" >/dev/null
  fail "Could not keep a copy for Undo, so nothing was deleted."
fi

say "2/3 Deleting…"
if ! clear_sql | docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$DB_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -q >/dev/null; then
  docker start "$BACKEND_CONTAINER" >/dev/null
  fail "The delete failed and was rolled back; nothing was changed."
fi

say "3/3 Starting the Backend…"
docker start "$BACKEND_CONTAINER" >/dev/null
wait_healthy "$BACKEND_CONTAINER" 180 || fail "The Backend didn't come back healthy. Try \"Undo the last reset\"."
say "Done: $(summary "$DB_NAME")."
echo "Reload the app tabs. To make this the state every reset goes back to, run \"1 Save demo snapshot\"."
echo "To bring everything back, run \"Undo the last reset\"."
pause_and_exit 0
