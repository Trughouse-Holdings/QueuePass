# Data Model: Names on Tickets and Gate Check-In

Three new nullable columns and two CHECKs, in one migration:
`backend/prisma/migrations/<timestamp>_gate_check_in/`. No new table, index, or enum. Existing rows
are untouched: their new columns start as `NULL`.

## Order (changed)

| Field | Type | Rule |
|---|---|---|
| `holderName` | `TEXT?` | New (research R1). The buyer's name, on every ticket of the order. Set once, when the order is placed; never updated (FR-001a). `NULL` for orders placed before this feature (FR-005). The Backend requires it on every new order (R2). |

```sql
ALTER TABLE "Order" ADD COLUMN "holderName" TEXT;

-- FR-003 backstop (research R2): the Backend's rules are richer (a letter, no control
-- characters); the database guarantees the length and the trimming.
ALTER TABLE "Order" ADD CONSTRAINT "order_holder_name_valid"
  CHECK ("holderName" IS NULL
    OR (char_length("holderName") BETWEEN 1 AND 100 AND "holderName" = btrim("holderName")));
```

## Ticket (changed)

| Field | Type | Rule |
|---|---|---|
| `checkedInAt` | `TIMESTAMPTZ?` | Existing (spec 005). Now the time of the ticket's one **entry**, set by `admitTicket` from the database clock (research R3, R4). Never cleared: not by cancellation, not by anything else (FR-018). |
| `checkedInBySub` | `TEXT?` | New. The admitting gate agent's Keycloak subject identifier (Constitution V). |
| `checkedInByUsername` | `TEXT?` | New. A display copy of the agent's `preferred_username`, as `Order.customerUsername` is for buyers. |

```sql
ALTER TABLE "Ticket" ADD COLUMN "checkedInBySub" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "checkedInByUsername" TEXT;

-- Research R3: an agent only with an entry, and both agent columns together. An entry with no
-- agent stays allowed: demo check-ins made before this feature have none.
ALTER TABLE "Ticket" ADD CONSTRAINT "ticket_entry_agent"
  CHECK (("checkedInBySub" IS NULL AND "checkedInByUsername" IS NULL)
    OR ("checkedInBySub" IS NOT NULL AND "checkedInByUsername" IS NOT NULL
        AND "checkedInAt" IS NOT NULL));
```

**Exactly one entry** (FR-015) is not a constraint but the admit statement's guarantee: a single
conditional `UPDATE … WHERE "checkedInAt" IS NULL AND "status" = 'VALID'`, which PostgreSQL
re-checks after waiting on any concurrent writer of the same row (research R4). A ticket row has one
`checkedInAt`, so it cannot have two entries.

**Lookups by code** use the existing unique index `Ticket_code_key`. **Admit all** finds an order's
tickets with the existing `Ticket_orderId_idx`. Neither needs a new index.

## Ticket states at the gate

Derived, not stored. Computed in one query on the database's clock (research R5), in this order:

| State | When |
|---|---|
| `OTHER_EVENT` | the ticket's `eventId` is not the event the agent is working |
| `VOID` | `status = 'VOID'` (its order was refunded, e.g. the event was cancelled) |
| `USED` | `checkedInAt IS NOT NULL` (returned with `usedAt`) |
| `NOT_OPEN` | `now() < startsAt - 2 hours` (returned with `entryOpensAt`) |
| `ENDED` | `now() >= endsAt` |
| `ADMITTABLE` | none of the above |

Admitting moves a ticket from `ADMITTABLE` to `USED`, once and for good. Cancelling the event
moves a `VALID` ticket to `VOID` (spec 005) and leaves its `checkedInAt` as it was.

## Prisma schema changes

```prisma
model Order {
  // …
  // Spec 017 FR-001: the buyer's name, on every ticket; NULL before 017 (CHECK in migration SQL).
  holderName       String?
}

model Ticket {
  // …
  checkedInAt         DateTime? @db.Timestamptz(6)
  // Spec 017 research R3: who admitted it; both or neither, and only with checkedInAt.
  checkedInBySub      String?
  checkedInByUsername String?
}
```

## Not stored

- **Refused ID checks** (FR-017): the app records nothing, and calls nothing.
- **The gate agent's chosen event** (FR-007): kept in the Ticket Booth app's tab
  (`sessionStorage`), not by the Backend.
- **The QR code**: drawn by the Customer app from the ticket's code (research R8).
