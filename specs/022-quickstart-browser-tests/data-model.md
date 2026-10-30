# Data Model: Quickstart Browser Tests

**Feature**: `022-quickstart-browser-tests` | **Spec**: [spec.md](./spec.md)

No product data changes: no Prisma schema change, no migration, no Keycloak change, no API change.
The browser-test stack is created and destroyed by every run (research R3).

## Files this feature adds

| Thing | Shape | Rule |
| --- | --- | --- |
| Browser test | `test('NNN <label>: <description>', …)` in `e2e/tests/*.spec.ts` | Title starts with a built feature's number and a scenario label from that feature's quickstart (FR-003); creates its own data (R8) |
| Automation table | `## Automation` at the end of each `specs/*/quickstart.md`; rows `\| <label> \| Automated: \`<test title>\` \|` or `\| <label> \| Manual: <reason> \|` | One row per scenario heading label (`^#{2,3} ([A-Z]{1,2}\d+)\b`), exactly once (FR-007, R10) |
| Address stand-in data | `e2e/stack/geocoder-stub/addresses.json`: `[{ street, city, state, zip, matchedAddress, x, y }]` | The four addresses of R4, real coordinates (`x` longitude, `y` latitude, as the Census answer) |

## Test accounts (seed, unchanged)

| Range | Used by browser tests (R8) | Left for people |
| --- | --- | --- |
| `admin1`–`admin5` | `admin2`–`admin4` (one per worker) | `admin1`, `admin5` |
| `agent1`–`agent30` | `agent10`–`agent24` | `agent1`–`agent9`, `agent25`–`agent30` |
| `customer1`–`customer200` | `customer100`–`customer159` | the rest |
