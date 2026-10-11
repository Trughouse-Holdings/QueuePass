# Data Model: Venue Address Validation and Google Maps Link

Four new columns and three CHECKs on `Location`, in one migration:
`backend/prisma/migrations/20261011120000_venue_address_parts/`.

## Location (changed)

| Field | Type | Rule |
|---|---|---|
| `address` | `String` (unchanged) | Always set. For a verified venue, built from the parts as `STREET, CITY, ST ZIP`. For a venue from before `013`, the text it was saved with. |
| `street` | `String? @db.VarChar(200)` | The address service's standard form, such as `430 W VINE ST`. |
| `city` | `String? @db.VarChar(100)` | Such as `LEXINGTON`. |
| `state` | `String? @db.VarChar(2)` | Two-letter code from `US_STATES` (the 50 states and DC). |
| `zip` | `String? @db.VarChar(5)` | Five digits. ZIP+4 is accepted as input, never stored. |

All four parts are set together, or all are `NULL`. `NULL` parts mean the address is **not
verified** (a venue from before `013`, not yet re-addressed). No coordinates are stored
(research R4).

```sql
ALTER TABLE "Location"
  ADD COLUMN "street" VARCHAR(200),
  ADD COLUMN "city"   VARCHAR(100),
  ADD COLUMN "state"  VARCHAR(2),
  ADD COLUMN "zip"    VARCHAR(5);

ALTER TABLE "Location" ADD CONSTRAINT "location_address_parts_all_or_none"
  CHECK (("street" IS NULL AND "city" IS NULL AND "state" IS NULL AND "zip" IS NULL)
      OR ("street" IS NOT NULL AND "city" IS NOT NULL AND "state" IS NOT NULL AND "zip" IS NOT NULL));

ALTER TABLE "Location" ADD CONSTRAINT "location_address_parts_format"
  CHECK (("state" IS NULL OR "state" ~ '^[A-Z]{2}$')
     AND ("zip" IS NULL OR "zip" ~ '^[0-9]{5}$'));

ALTER TABLE "Location" ADD CONSTRAINT "location_address_matches_parts"
  CHECK ("street" IS NULL
      OR "address" = "street" || ', ' || "city" || ', ' || "state" || ' ' || "zip");
```

- **No backfill and no parse**: existing rows get `NULL` parts and keep `address` (research R5).
  The migration makes no network call.
- **The service writes** the parts and `address` together, in one statement, only after the
  address service matched them (research R7). The CHECKs are the backstop.
- **Which states**: the database checks only the format; the list of 51 codes is checked by the
  Backend DTO against `US_STATES`, which a test keeps equal to the contract's `UsState` enum.
- **Search** (`004` FR-007) still matches `name` or `address`, unchanged.

## Address check (not stored)

One call per create, and per edit whose address changed (research R7):

```text
lookup(street, city, state, zip5) →
    match { street, city, state, zip }   save these, build address
  | none                                 400 ADDRESS_NOT_FOUND
  | many { candidates[≤5] }              400 ADDRESS_AMBIGUOUS
  | throws unavailable                   503 ADDRESS_SERVICE_UNAVAILABLE
```

"Changed" on edit:

```text
norm(s)   = upper(collapse_spaces(trim(s)))
unchanged = stored.street IS NOT NULL
        and norm(street) = stored.street and norm(city) = stored.city
        and state = stored.state and zip[0..5] = stored.zip
```

## Shared types and helpers (`packages/shared/src/location.ts`)

- `US_STATES`: `readonly { code: UsState; name: string }[]`, the 50 states and DC; `UsState` is
  the union of the codes.
- `Location`: gains `street: string | null`, `city: string | null`, `state: UsState | null`,
  `zip: string | null`. `address` unchanged.
- `LocationInput`: `{ name; street; city; state: UsState; zip; seatingCapacity }` (no `address`).
  `LocationUpdate = Partial<LocationInput>`.
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
- `packages/shared/src/api-schema.ts`: regenerated from contract 1.6.0 (in this PR).
