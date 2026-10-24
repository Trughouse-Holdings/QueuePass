# Data Model: Rotating QR Codes

One new column, one extension, and one CHECK, in one migration
(`backend/prisma/migrations/<timestamp>_live_codes/migration.sql`). Nothing else in the schema
changes. Decisions: [research.md](./research.md) R1–R3.

## Ticket (changed)

| Field | Type | Rule |
|---|---|---|
| `entrySecret` | `BYTEA NOT NULL DEFAULT gen_random_bytes(32)` | The ticket's entry secret (spec Key Entities). 32 random bytes from `pgcrypto`, made by the database on every insert and filled into every existing row when the column is added. Never changes. CHECK `ticket_entry_secret_32_bytes`: `octet_length("entrySecret") = 32`. |

Prisma:

```prisma
// Spec 018 research R1: the key for this ticket's live codes. Never selected unless named
// (PrismaService's global omit), never printed, never in any response but getTicketEntryKey.
entrySecret Bytes @default(dbgenerated("gen_random_bytes(32)")) @db.ByteA
```

The migration, in order:

1. `CREATE EXTENSION IF NOT EXISTS pgcrypto;`
2. `ALTER TABLE "Ticket" ADD COLUMN "entrySecret" BYTEA NOT NULL DEFAULT gen_random_bytes(32);`
   (a volatile default, so each existing row gets its own value);
3. `ALTER TABLE "Ticket" ADD CONSTRAINT ticket_entry_secret_32_bytes CHECK (octet_length("entrySecret") = 32);`

No index: the secret is only ever read by the ticket's primary key.

**Who reads it**: `getTicketEntryKey` (the buyer, research R5) and the live-code path of
`lookupEntryTicket` (research R4), each with an explicit `select`. `PrismaService` passes
`omit: { ticket: { entrySecret: true } }` to the Prisma client, so every other query leaves it out.

## Live code (not stored)

`QP1:<TICKET>:<WINDOW>:<MAC>` (research R2), made in the Customer app and checked by the Backend,
both with `packages/shared/src/live-code.ts`.

| Part | Value |
|---|---|
| `TICKET` | The ticket's UUID, 32 upper-case hex digits, no dashes |
| `WINDOW` | `floor(unixMilliseconds / 30000)`, decimal |
| `MAC` | First 10 bytes of `HMAC-SHA256(entrySecret, "QP1:<TICKET>:<WINDOW>")`, base32 (RFC 4648, no padding), 16 characters |

## Window (not stored)

Window `w` is `[w × 30 s, (w + 1) × 30 s)` in UTC. A live code for `w` is accepted on the Backend's
clock in `[w × 30 s − 5 s, (w + 1) × 30 s + 5 s)` (research R3).

## Unchanged

- **Entry**: `Ticket.checkedInAt` and its agent columns (spec 017 data-model), at most one per ticket,
  whichever code was used (FR-015).
- **Order**, **Event**, and every other table.

## State, as the gate sees a live code

| Step | Outcome |
|---|---|
| Not in live-code form, MAC wrong, or no such ticket | `404 LIVE_CODE_INVALID` |
| Genuine, outside window and grace | `409 LIVE_CODE_EXPIRED` |
| Genuine, in window and grace | spec 017's states (`VOID`, `OTHER_EVENT`, `USED`, `NOT_OPEN`, `ENDED`, `ADMITTABLE`), `verifiedBy: LIVE_CODE` |
