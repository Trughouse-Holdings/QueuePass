# Data Model: Rust Customer App

**Feature**: `040-rust-customer-app` | **Date**: 2026-11-15

## Persistent data

**No change.** No Prisma model, migration, or OpenAPI schema is added or changed. The Rust Customer
app reads and writes the same events, venues, ticket types, seat maps, reservations, orders,
tickets, entry keys, and pictures as the React Customer app, through the same API. Orders,
tickets, reservations, and attempt allowances are keyed by the token's `sub` (`customerSub` in
Prisma), which is the same in both Customer apps because they share the realm (spec Key Entities).

## Configuration entities

### Shared-realm client row (`SHARED_REALM_CLIENTS`, new)

A front end with its own client in another app's realm (research R3). `APP_REALMS` is unchanged.

| Field | Value for this feature | Rule |
|---|---|---|
| `app` | `'customer-rust'` | unique across `APP_REALMS` and this table |
| `realm` | `'queuepass-customer-app'` | MUST be one of `APP_REALMS`' realms |
| `clientId` | `'customer-rust-app'` | unique across both tables |

The row has no `role`, `prefix`, or `count`: the app uses its realm's role (`customer`) and users,
so the seed makes no account for it, and the total stays 240. Copies: `scripts/seed/src/app-realms.ts`
and `e2e/fixtures/realms.ts`, checked equal by `packages/shared/test/realms.test.ts`.

`realmOfApp(app)`: the realm of an `APP_REALMS` row or a `SHARED_REALM_CLIENTS` row, by `app`.

### Seed client row (`FRONTEND_CLIENTS` in `provision-clients.ts`)

`{ clientId: 'customer-rust-app', name: 'QueuePass Tickets (Rust)', port: 5177 }`, converged by the
existing `provisionClient` into realm `queuepass-customer-app` with the default scopes `roles` and
`queuepass-api` (the audience mapper).

## Rust Customer app internal model (in memory only)

These types live in `core` (research R10). Nothing is stored.

| Type | Holds | Ported from |
|---|---|---|
| `AuthState` / `AuthMachine` | as `037` data-model, required role `customer` | copied from `admin-rust-app/core/src/auth` |
| `ApiError` | `status`, `code`, `message`, `details` | copied |
| `EventFilters` | `q`, `venue`, `from`, `to`, `hide_cancelled`; URL read and write; the request query | `filters.ts` (parity B3, B4) |
| `Availability` view | closed reason and badge, started note, limit line or box, tickets left, quantity bounds, "From" price | `GetTickets.tsx` general part (P1–P6, E5–E7) |
| `Purchase` | tier, quantity, name, `request_id`, sending flag, outcome (`Done`, `Refused`, `Unknown`, `Limited { until }`) | `use-buy.ts` (P7–P10, C6) |
| `Waits` | BUY and HOLD wait deadlines on the monotonic clock | `use-buy.ts` `useWaits` (P10) |
| `HoldQueue` | queued and in-flight seat actions (hold or release) in click order | `use-hold-queue.ts` (M10) |
| `Reservation` | event, `created_at`, seats with level and price, deadline (monotonic), warned flag, run-out flag | `GetTickets.tsx`, `HoldCountdown.tsx` (M11) |
| `SeatView` inputs | the seat's map state, mine, queued or in-flight action, released-here and refused-here sets | `GetTickets.tsx` `seatView` (M9) |
| `HoldLog` | at most 5 lines, the time of the last | `GetTickets.tsx` (M12) |
| `Cart` | entries keyed by event and `created_at`, each with its fixed deadline, details state and retries, purchase; confirmations; status and alert texts; gone set | `Cart.tsx` (C1–C10) |
| `VenueMapState`, `View` | copied from `037` | `map-state.ts`, `use-pan-zoom.ts` (M4–M8, M14) |
| `OrderCard` view | upcoming or Past (by the load time), ticket state text, which links show, calendar eligible | `MyTickets.tsx`, `calendar.ts` (T1–T5) |
| `CalendarEvent` | name, start, end, venue, address; ICS text, file name, Google URL | `calendar.ts` (T6, T7) |
| `LiveCodeClock` | key, ticket, server offset, current window and code | `live-code-clock.ts`, `live-code.ts` (T11) |
| `QrMatrix` | module grid for a text, version, level M, mask | `qrcode-generator` via `TicketQr.tsx` (T12) |

### State transitions: `Reservation` on the event page (parity M11)

```text
None ──hold 201──▶ Held(deadline = now + secondsLeft) ──more seats──▶ Held (same deadline)
Held ──≤ 60 s──▶ Held + warned ("1 minute left to buy your seats.")
Held ──0:00──▶ RanOut (alert; seats wait 2 minutes) ──▶ None
Held ──last seat released──▶ None ("…the next seat you click starts a new 5 minutes.")
Held ──Backend ends it > 2 s early (other tab, other Customer app)──▶ None ("Your held seats were released.")
Held ──Add to cart──▶ /cart (Cart entry with the same Backend secondsLeft)
```

### State transitions: Cart entry (parity C5–C8)

```text
Seen (deadline fixed) ──Buy tickets──▶ Buying ──2xx──▶ Bought (confirmation at top)
                                         ├──RESERVATION_REQUIRED expired──▶ RanOut
                                         ├──refused──▶ Seen + refusal
                                         ├──429──▶ Seen + BUY wait
                                         └──5xx / no answer──▶ Unknown (Check again)
Seen ──0:00, nothing in flight──▶ RanOut
Seen ──gone from a read──▶ (within 2 s of deadline) RanOut | (else) one /me/orders read ──▶ BoughtElsewhere | Ended
```
