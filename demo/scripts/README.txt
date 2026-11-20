QueuePass demo scripts (made 2026-11-19 for the EDIS demo)

Double-click a .command file to run it. It opens a Terminal window, says what it's doing, and
waits for Enter before closing. (The first time, macOS may ask to allow Terminal: allow it, or
right-click the file > Open.)

1 Save demo snapshot
    Saves the data as it is right now (venues, events, orders, tickets, seat holds, check-ins).
    Run it once when everything looks the way you want to start each demo. Saving again keeps
    the one before as snapshots/demo-snapshot.previous.dump. Snapshots hold the demo's data, so
    snapshots/ is not committed (see .gitignore).

2 Reset after a demo
    Puts the data back to the snapshot. Anything made during the demo (a new venue, events,
    tickets bought, check-ins) is gone. Takes about 10 seconds. Press Enter to confirm.
    Afterwards reload the app tabs. Sign-in accounts (admin1, customer1, agent1) don't change.
    Safe: the snapshot is loaded on the side first and only swapped in if that worked.

3 Start and open the apps
    Starts the team stack if it's stopped (for example after a restart), waits until it's
    ready, and opens Admin (5173), Customer (5174) and Ticket Booth (5175) in the browser.

4 Clear events and venues (keep KFC)
    Deletes every event (with its orders, tickets, seat holds and check-ins), the KFC Yum!
    Center's events too, and every venue except the KFC Yum! Center, which keeps its layouts.
    It lists what it will delete and waits for Enter. Afterwards, run "1 Save demo snapshot"
    if you want resets to come back to this cleared state. (The venue kept is set by name in
    common.sh: KEEP_VENUE.)

Undo the last reset
    Brings back the data from just before the last reset or clear, if you did it by mistake.
    Running it again swaps back.

Needs Docker Desktop running. These scripts only touch the "queuepass-team" stack's database;
they don't change code or the app images. common.sh holds the shared settings.
