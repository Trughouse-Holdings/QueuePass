# Data Model: Venue Address Validation and Google Maps Link

Five new columns and four CHECKs on `Location`, in one migration:
`backend/prisma/migrations/20261011120000_venue_address_parts/`.

## Location (changed)

| Field | Type | Rule |
|---|---|---|
| `address` | `String` (unchanged) | Always set. When the parts are set, built from them as `STREET, CITY, ST ZIP`. For a venue from before `013`, the text it was saved with. |
| `street` | `String? @db.VarChar(200)` | Verified: the service's standard form, such as `430 W VINE ST`. Saved anyway: as the admin sent it, trimmed. |
| `city` | `String? @db.VarChar(100)` | Such as `LEXINGTON`. |
| `state` | `String? @db.VarChar(2)` | Two-letter code from `US_STATES` (the 50 states and DC). |
| `zip` | `String? @db.VarChar(5)` | Five digits. ZIP+4 is accepted as input, never stored. |
| `addressVerified` | `Boolean @default(false)` | `true` only when the address service matched the stored parts. |

All four parts are set together, or all are `NULL`. No coordinates are stored (research R4).

| Kind | Parts | `addressVerified` |
|---|---|---|
| Verified | standard form | `true` |
| Saved anyway | as sent | `false` |
| From before `013` | `NULL` | `false` |

```sql
ALTER TABLE "Location"
  ADD COLUMN "street" VARCHAR(200),
  ADD COLUMN "city"   VARCHAR(100),
  ADD COLUMN "state"  VARCHAR(2),
  ADD COLUMN "zip"    VARCHAR(5),
  ADD COLUMN "addressVerified" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Location" ADD CONSTRAINT "location_address_parts_all_or_none"
  CHECK (("street" IS NULL AND "city" IS NULL AND "state" IS NULL AND "zip" IS NULL)
      OR ("street" IS NOT NULL AND "city" IS NOT NULL AND "state" IS NOT NULL AND "zip" IS NOT NULL));

ALTER TABLE "Location" ADD CONSTRAINT "location_address_parts_format"
  CHECK (("state" IS NULL OR "state" ~ '^[A-Z]{2}$')
     AND ("zip" IS NULL OR "zip" ~ '^[0-9]{5}$'));

ALTER TABLE "Location" ADD CONSTRAINT "location_address_matches_parts"
  CHECK ("street" IS NULL
      OR "address" = "street" || ', ' || "city" || ', ' || "state" || ' ' || "zip");

ALTER TABLE "Location" ADD CONSTRAINT "location_verified_has_parts"
  CHECK (NOT "addressVerified" OR "street" IS NOT NULL);
```

- **No backfill and no parse**: existing rows get `NULL` parts, `addressVerified = false`
  (the column default), and keep `address` (research R5). The migration makes no network call.
- **The service writes** the parts, `address`, and `addressVerified` together, in one statement,
  only after the address service answered (research R2, R7). The CHECKs are the backstop: a
  verified venue always has parts, and a venue without parts is never verified.
- **Which states**: the database checks only the format; the list of 51 codes is checked by the
  Backend DTO against `US_STATES`, which a test keeps equal to the contract's `UsState` enum.
- **Search** (`004` FR-007) still matches `name` or `address`, unchanged.

## Address check (not stored)

One call per create, and per edit whose address changed (research R7):

```text
lookup(street, city, state, zip5) →
    match { street, city, state, zip }   save these, verified = true      (flag ignored)
  | none                                 flag ? save as sent, verified = false
                                              : 400 ADDRESS_NOT_FOUND
  | many { candidates[≤5] }              flag ? save as sent, verified = false
                                              : 400 ADDRESS_AMBIGUOUS
  | throws unavailable                   503 ADDRESS_SERVICE_UNAVAILABLE   (flag ignored)

flag = acceptUnverifiedAddress === true
"as sent" = collapse_spaces(trim(street)), collapse_spaces(trim(city)), state, zip[0..5]
            (one rule everywhere: trim, collapse runs of whitespace to one space, the state
            code as validated, the first 5 digits of the ZIP; the admin's case is kept)

A single match that does not split into street, city, a listed state, and a 5-digit ZIP is
`none` (logged at warn). Candidates are reformatted to "STREET, CITY, ST ZIP"; one that does
not split is shown raw (research R3).
```

"Changed" on edit:

```text
norm(s)   = upper(collapse_spaces(trim(s)))
unchanged = stored.street IS NOT NULL
        and norm(street) = norm(stored.street) and norm(city) = norm(stored.city)
        and state = stored.state and zip[0..5] = stored.zip
```

Unchanged → no lookup; parts, `address`, and `addressVerified` are left as stored.

## Venue update write (research R7)

```text
no lock:      DTO → exists → all-four-or-none, flag only with four → capacity rules (fast check)
              → lookup if the address changed (≤ 5 s)
transaction:  SELECT "Location" … FOR UPDATE → SELECT scheduled "Event" … ORDER BY id FOR UPDATE
              → re-run capacity rules on fresh data → UPDATE "Location"
```

Same lock order as `layout.service.ts` (venue, then its scheduled events), through one shared
helper in `backend/src/common/venue-lock.ts`.

## Shared types and helpers (`packages/shared/src/location.ts`)

- `US_STATES`: `readonly { code: UsState; name: string }[]`, the 50 states and DC; `UsState` is
  the union of the codes.
- `Location`: gains `street: string | null`, `city: string | null`, `state: UsState | null`,
  `zip: string | null`, `addressVerified: boolean`. `address` unchanged. Until the research R11
  follow-up tightens the contract, the five are declared optional (`street?: string | null`, …,
  `addressVerified?: boolean`), mirroring the contract: required shared fields fail both front
  ends' `tsc` against the generated types, whose fields are optional (found in the
  implementation). The Backend always sends them. The follow-up (tasks.md T044) makes them
  required here too.
- `LocationInput`: `{ name; street; city; state: UsState; zip; acceptUnverifiedAddress?: boolean;
  seatingCapacity }` (no `address`). `LocationUpdate = Partial<LocationInput>`.
- `LOCATION_LIMITS`: adds `streetMaxLength: 200`, `cityMaxLength: 100`; `ZIP_PATTERN =
  /^\d{5}(-\d{4})?$/`.
- `formatAddress({ street, city, state, zip })` → `STREET, CITY, ST ZIP`. Used by the Backend
  only, so the format has one definition.
- `mapsUrl(address)` → `https://www.google.com/maps/search/?api=1&query=` +
  `encodeURIComponent(address)`.
- `packages/shared/src/web/address-link.tsx`: `AddressLink` (research R10).
- `packages/shared/src/errors.ts`: `ADDRESS_NOT_FOUND`, `ADDRESS_AMBIGUOUS`,
  `ADDRESS_SERVICE_UNAVAILABLE` added to `ERROR_CODES`, in the contract's order. Without them the
  exception filter would rewrite the `503` as `VALIDATION_FAILED`.
- `packages/shared/src/api-schema.ts`: regenerated from contract 1.7.0 (in this PR).
