# Data Model: Demo Checkpoint

**Feature**: `029-demo-checkpoint` | **Spec**: [spec.md](./spec.md)

**No schema change.** `backend/prisma/` is unchanged: no table, column, constraint, or migration. The
reset removes rows and the demo data adds rows, through the schema as it is.

## What the reset removes (research R2)

Every base table in the current schema except `_prisma_migrations`, listed from `pg_tables` at run
time. Today:

| Table | Printed as | Holds |
| --- | --- | --- |
| `Location` | venues | venues (`002`, `013`, `020`) |
| `Section` | seating sections | a venue's layout (`007`) |
| `Event` | events | events (`002`, `005`, `016`, `025`) |
| `TicketTier` | tiers | an event's tiers (`004`) |
| `SectionTier` | section tiers | which tier a section sells at an event (`007`) |
| `EventImage` | images | up to 5 per event (`014`) |
| `Order` | orders | orders, with holder names (`005`, `017`) |
| `Ticket` | tickets (N checked in) | tickets, their check-ins, live-code secrets (`005`, `017`, `018`) |
| `SeatReservation` | seat reservations | a customer's 5-minute claim (`015`) |
| `SeatHold` | seat holds | seats in a reservation, live and ended (`015`) |

A table added later is removed too and printed under its own name (FR-004).

## What the reset keeps

| Kept | Why |
| --- | --- |
| `_prisma_migrations` | the record of applied migrations; checked before the wipe (research R7) |
| The schema: tables, columns, indexes, `event_no_overlap`, every CHECK, enums, `btree_gist` | `TRUNCATE` removes rows only (FR-005) |
| Keycloak: realms, clients, roles, accounts, sessions | not touched (FR-008) |
| The running Backend's purchase attempt counts | in its memory, gone within a minute (research R3) |

## The demo state (FR-007, research R5)

What `runDemoData` creates, relative to the moment `t` of the run and its local date `d` at each venue
(both venues are Eastern by address or by default). Unchanged from today but the last row.

| Event | Venue | When (local) | Status | Tiers | Orders | Images |
| --- | --- | --- | --- | --- | --- | --- |
| Fall Concert | QueuePass Demo Arena | `d` + 14, 7:00–10:00 PM | scheduled, on sale | General $45 × 400, VIP $120 × 100 | 25 (40% of its tickets checked in by `demo-agent1`) | 3 |
| Comedy Night | Demo Riverside Hall | `d` + 21, 8:00–11:00 PM | scheduled, on sale; limit 4 per customer | none ($25) | 12 | 1 |
| Demo Tonight | Demo Riverside Hall | `t` + 1 h to `t` + 4 h (whole minute); doors at `t` | scheduled; check-in open until `t` + 4 h | none ($20) | 8 (one of 4) | 0 |
| Holiday Gala | QueuePass Demo Arena | `d` + 30, 7:00–10:00 PM | cancelled | Floor $80 × 200, Balcony $50 × 100 | 8 placed before it was cancelled | 0 |
| **Season Opener** (new) | Demo Riverside Hall | `d` − 7, 7:00–10:00 PM | scheduled, over; sales closed | none ($30), capacity 150 | 0 | 0 |

Orders belong to `demo-customer1`…`demo-customer25` (usernames `customer1`…`customer25`), holder names
from the fixed list (`017` research R13). Every event's doors open 1 hour before its start (`025`).

`DemoSummary` (in `demo-data.ts`) gains `past: string | null`; `events` becomes 5.

## The reset's summary (in memory, printed)

| Field | Value |
| --- | --- |
| `target` | `{ host, port, database }` from `DATABASE_URL`, never the password |
| `removed` | per table: rows before the wipe; plus tickets checked in |
| `created` | the `DemoSummary` of R5 |
| `tonightClosesAt` | Demo Tonight's `endsAt`, shown in its venue's zone |
| `ms` | how long the whole reset took |

## Configuration

| Variable | Where it is set | Value |
| --- | --- | --- |
| `QUEUEPASS_ALLOW_RESET` | on the command line only (`docker compose exec -e …`; typed in front of `run-host.mjs --demo-reset`, which passes it on and never sets it; `scripts/e2e.mjs`'s exec, the one automatic place, for its throwaway `qpe2e` stack) | exactly `1` allows; anything else refuses |
| `DATABASE_URL` | as for the Backend (Compose: host `database`; path B: `localhost`) | host must be `localhost`, `127.0.0.1`, `::1`, or (inside a container only) `database` |

Never in `docker-compose.yml`, `e2e/stack/docker-compose.e2e.yml`, `.env.example`, or a workflow
(FR-003; a root script test checks it).
