#!/bin/bash
# Saves the team stack's data as it is now: the state every reset goes back to.
# Run it once when the demo data looks the way you want it, before showing anything.
source "$(dirname "$0")/common.sh"

need_docker
say "Saving a snapshot of the data now: $(summary "$DB_NAME")"
mkdir -p "$HERE/snapshots"
tmp="$SNAPSHOT.saving"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$tmp" || { rm -f "$tmp"; fail "The snapshot could not be saved."; }
[ -s "$tmp" ] || { rm -f "$tmp"; fail "The snapshot came out empty."; }
[ -f "$SNAPSHOT" ] && mv "$SNAPSHOT" "$PREVIOUS"
mv "$tmp" "$SNAPSHOT"
say "Saved: snapshots/demo-snapshot.dump ($(du -h "$SNAPSHOT" | cut -f1 | tr -d ' '))."
[ -f "$PREVIOUS" ] && echo "The snapshot before this one is kept as snapshots/demo-snapshot.previous.dump."
echo "After a demo, double-click \"2 Reset after a demo\" to come back to exactly this."
pause_and_exit 0
