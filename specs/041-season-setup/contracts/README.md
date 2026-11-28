# Contract Changes: 041 Season Setup and the Shared Season Contract

**Contract**: `contracts/openapi.yaml` **2.1.0 → 2.2.0** (additions only), in this spec PR
(research R3, R14, R15). `packages/shared/src/api-schema.ts` is regenerated with
`npm run generate:api`; `scripts/check-contract-drift.mjs` keeps them equal.

## New operations (tag `seasons`)

| Operation | Method and path | Roles | Marker | Served by |
| --- | --- | --- | --- | --- |
| `listSeasons` | `GET /seasons` | any signed in (admins: all; others: on sale) | `x-planned: '041'` | 041 |
| `createSeason` | `POST /seasons` | `queuepass-admin` | `x-planned: '041'` | 041 |
| `getSeason` | `GET /seasons/{id}` | any signed in (others: on sale only) | `x-planned: '041'` | 041 |
| `updateSeason` | `PUT /seasons/{id}` | `queuepass-admin` | `x-planned: '041'` | 041 |
| `deleteSeason` | `DELETE /seasons/{id}` | `queuepass-admin` | `x-planned: '041'` | 041 |
| `publishSeason` | `POST /seasons/{id}/publish` | `queuepass-admin` | `x-planned: '041'` | 041 |
| `cancelSeason` | `POST /seasons/{id}/cancel` | `queuepass-admin` | `x-planned: '041'` | 041 |
| `getSeasonVenueMap` | `GET /seasons/{id}/venue-map` | any signed in | `x-planned: '042'` | 042 |
| `getSeasonVenueMapSection` | `GET /seasons/{id}/venue-map/sections/{sectionId}` | any signed in | `x-planned: '042'` | 042 |
| `holdSeasonSeat` | `POST /seasons/{id}/pass-hold` | `customer`, `x-attempt-limit: HOLD` | `x-planned: '042'` | 042 |
| `releaseSeasonSeat` | `POST /seasons/{id}/pass-hold/release` | `customer` | `x-planned: '042'` | 042 |
| `buySeasonPass` | `POST /seasons/{id}/passes` | `customer`, `x-attempt-limit: BUY` | `x-planned: '042'` | 042 |
| `listMyPasses` | `GET /me/passes` | `customer` | `x-planned: '042'` | 042 |

Each implementation removes its operations' markers in the change that serves them; the
route-coverage test fails if a marked operation is served or an unmarked one is not. That test now
also skips planned operations when matching `@AttemptLimit` routes to `x-attempt-limit` (each still
declares its `429`).

## New schemas

`Sport`, `SeasonRef`, `SeasonEventSummary`, `SeasonPrice`, `SeasonPriceInput`, `Season`,
`SeasonInput`, `SeasonCancellation`, `OrderSeasonPass` (041); `PassHoldInput`, `PassHold`,
`SeasonPassInput`, `SeasonPass` (042). The Season venue-map operations reuse `VenueMap` and
`VenueMapSection`.

## Changed schemas (new fields optional until the implementation)

| Schema | New field | Required from |
| --- | --- | --- |
| `Event` | `season` (`SeasonRef` or `null`), `singleSalesOpenAt` | 041's implementation |
| `Order` | `seasonPass` (`OrderSeasonPass` or `null`) | 041's implementation |
| `EventSales` | `passTicketsSold`, `passRevenue` | 041's implementation |
| `SalesReport.totals` | `passTicketsSold`, `passRevenue` | 041's implementation |

041's implementation moves each into its schema's `required` list (with the 2.2.x patch noted in
`info.version`'s history as earlier features did: "Required from 2.2.0 once implemented").

## New error codes (`ErrorEnvelope.code` and `ERROR_CODES`)

`EVENT_IN_SEASON`, `SEASON_HAS_PASSES`, `SEASON_CANCELLED`, `SEASON_NOT_DRAFT`,
`SEASON_NOT_ON_SALE` (041); `SEASON_PRESALE`, `SEASON_SALES_CLOSED`, `PASS_LIMIT_REACHED` (042).
When each is used, and its `details`: research R4.

## Rules stated in the document's introduction

A new **Seasons** paragraph: an event is in at most one Season; what an event in a Season can't do
(`409 EVENT_IN_SEASON` on `updateEvent`, `deleteEvent`, `updateTicketTier`, `deleteTicketTier`);
cancelling an event refunds its pass orders; the presale refusal (`409 SEASON_PRESALE` on
`createOrder` and `reserveSeats`, served by 042); the lock order (research R2).

## Not changed

`createOrder`, `reserveSeats` and the other purchase operations keep their shapes; only the
presale refusal is added to their behaviour, by 042. No operation is retired.
