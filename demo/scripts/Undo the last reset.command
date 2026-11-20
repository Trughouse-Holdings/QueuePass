#!/bin/bash
# Brings back the data from just before the last reset or clear (for one done by mistake).
source "$(dirname "$0")/common.sh"

need_docker
exists=$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '$BEFORE_RESET_DB'")
[ "$exists" = "1" ] || fail "There is nothing to undo: no copy from before a reset or clear is saved."
say "Undo the last reset"
echo "Now:              $(summary "$DB_NAME")"
echo "Before the last reset or clear: $(summary "$BEFORE_RESET_DB")"
printf '\nPress Enter to swap back, or close this window to cancel. '
read -r _

docker stop "$BACKEND_CONTAINER" >/dev/null
if ! psql_admin >/dev/null <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$DB_NAME', '$BEFORE_RESET_DB') AND pid <> pg_backend_pid();
BEGIN;
ALTER DATABASE "$DB_NAME" RENAME TO "${DB_NAME}_swap";
ALTER DATABASE "$BEFORE_RESET_DB" RENAME TO "$DB_NAME";
ALTER DATABASE "${DB_NAME}_swap" RENAME TO "$BEFORE_RESET_DB";
COMMIT;
SQL
then
  docker start "$BACKEND_CONTAINER" >/dev/null
  fail "The swap failed; nothing was changed."
fi
docker start "$BACKEND_CONTAINER" >/dev/null
wait_healthy "$BACKEND_CONTAINER" 180 || fail "The Backend didn't come back healthy."
say "Done: $(summary "$DB_NAME"). (Running this again swaps back the other way.)"
pause_and_exit 0
