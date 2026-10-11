# Implementation Plan: Venue Address Validation and Google Maps Link

**Branch**: `013-venue-address-validation-spec` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)
| **Issue**: [#25](https://github.com/Trughouse-Holdings/QueuePass/issues/25)

**Input**: Feature specification from `specs/013-venue-address-validation/spec.md`

## Summary

- **Address service**: the US Census Geocoder behind one small interface, `AddressGeocoder`,
  injected with `ADDRESS_GEOCODER`. Base URL from `ADDRESS_GEOCODER_URL`, 5-second limit (research
  R1, R6, R12).
- **Rule**: exactly one match is saved in the service's standard form and verified; none is
  `400 ADDRESS_NOT_FOUND`, several are `400 ADDRESS_AMBIGUOUS`, and any failure to get an answer
  is `503 ADDRESS_SERVICE_UNAVAILABLE`. Nothing is written until the service has answered
  (R2, R3, R6).
- **Save anyway** (decided by the user, 2026-10-11): with `acceptUnverifiedAddress: true`, a
  not-found or ambiguous address is saved as sent and marked not verified. The lookup still runs,
  and the flag never bypasses `503` (R2, R8).
- **When**: on create, and on an edit whose address changed, after every other check and with no
  lock held. Name-only and capacity-only edits never call the service (R7).
- **Storage**: four nullable columns (`street`, `city`, `state`, `zip`) and
  `addressVerified boolean`, with CHECKs; `address` stays and is built from the parts. Existing
  venues keep their address, have `NULL` parts, and are not verified (R4, R5).
- **Admin app**: four address fields with a state list, the three refusals shown with values
  kept, a "Save anyway (address not verified)" control after a not-found or ambiguous refusal,
  the saved address shown after saving, and a "not verified" mark on the list, page, and form
  (R13).
- **Demo data**: real addresses; when the service is unavailable, the dev-only script saves its
  venues not verified through an internal service option no request can reach (R14).
- **Both apps**: one shared `AddressLink` that opens Google Maps in a new tab, used wherever an
  address is shown (R10).
- **Tests**: a fake geocoder in the test app; the real client tested against a local HTTP server.
  No test uses the network (R9).

Contract **1.6.0** (or 1.7.0 if `016` merges first) lands in this spec and plan PR with types
regenerated. New response fields and the four request fields are left out of `required`, so
`main` stays green before the implementation merges (R11).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged. **No new dependencies**: the client uses Node 22's global
`fetch` and `AbortSignal.timeout`.

**Storage**: PostgreSQL 17. Four columns and three CHECKs in one migration
([data-model.md](./data-model.md)).

**Testing**: Backend Jest + Supertest + Testcontainers with contract validation, using a fake
geocoder; `CensusGeocoder` tested against a local `node:http` server. Admin and Customer apps and
`packages/shared` Vitest + React Testing Library. Real service only in
[quickstart.md](./quickstart.md).

**Target Platform**: the existing Docker Compose stack on one laptop. The Backend container needs
outbound internet to save a new address.

**Project Type**: web application (one Backend, three front ends).

**Performance Goals**: at most one outside call per venue create or address change, bounded at
5 seconds. Reads are unchanged.

**Constraints**: no venue saved or re-addressed without either a match or an explicit "save
anyway", and never while the service is unavailable; no network call in tests or in the
migration; existing venues unchanged; no lock held during the outside call.

**Scale/Scope**: 0 new routes; 2 changed operations (`createLocation`, `updateLocation`); 1
changed schema embedded everywhere (`Location`); 1 new request flag; 3 new error codes; 1 new
environment variable.

## Constitution Check

Evaluated against constitution **v3.0.0**.

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | Contract 1.6.0 and regenerated types in this PR, before any code; drift check passes. Three new codes in the standard envelope, every refusal declared on its operation. The address service is called by the Backend only; no front end calls it. |
| **II. One Repo, One Command** | PASS | **PASS** | No new service or dependency. One variable with a working default in `.env.example`, `docker-compose.yml`, and code. One migration applied by the existing startup. `docker compose up --build` still starts with no manual step; saving a new address needs internet (README). |
| **III. Spec-Driven, Reviewed** | PASS | **PASS** | Issue #25; spec and plan on `013-venue-address-validation-spec`, reviewed by a second Claude session before the PR; implementation on `013-venue-address-validation-impl` in a fresh session, closing #25. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | The Backend decides (FR-018), including "save anyway", which is an explicit request field the Backend applies only after the lookup. CHECKs keep the parts all-or-none, well-formed, equal to `address`, and present whenever `addressVerified` is true. Refusals keep the admin's values (FR-011). Not a concurrency rule: venue edits stay last-write-wins, as today. |
| **V. Sign-In Everywhere** | PASS | **PASS** | No route or role changes; venue writes stay `queuepass-admin`. The outside call sends only the venue address, never a token or user data. |
| **VI. Test-First, Real Database** | PASS | **PASS** | Tests precede code in `tasks.md`; persistence and CHECKs tested on real PostgreSQL; no test uses the network (fake geocoder, local HTTP server). Boundaries tested both sides (ZIP formats, 5-second limit, one vs. two matches). The 80% floor is a recorded deferral until `010` and `011`; this feature reports its coverage. |
| **VII. Function Over Finish, One Shared Look** | PASS | **PASS** | Plain fields, a `<select>`, and a text link, reusing existing markup; `AddressLink` lives in `packages/shared` so both apps match. No new styles. |
| **VIII. Staged Simplicity** | PASS | **PASS** | No coordinates, no autocomplete, no map embed, no configurable timeout, no retry, no bulk re-check (spec Out of Scope). A boolean, not a timestamp, for verified. "Save anyway" is a per-request admin choice the user asked for, recorded on the venue, not a switch. No test-only bypass: tests replace the provider in the test module. The demo-data fallback is an internal argument of a dev script, unreachable from the API (R14). No security or correctness control deferred. |
| **Security** | PASS | **PASS** | No secret: the service needs no key. Configuration by environment variable with a default in `.env.example`. |
| **Shared surface** | — | **Needs every member's approval** | Touches `contracts/openapi.yaml`, `packages/shared/`, `backend/prisma/`, `.env.example`, and `docker-compose.yml`. |

## Project Structure

```text
specs/013-venue-address-validation/
├── spec.md, plan.md, research.md (R1–R14), data-model.md, quickstart.md (S1–S9, S2b), tasks.md
├── checklists/requirements.md
└── contracts/README.md

contracts/~ openapi.yaml                              # 1.6.0 (this PR)
packages/shared/src/~ api-schema.ts                   # regenerated (this PR)
packages/shared/src/~ location.ts, ~ errors.ts        # implementation PR
packages/shared/src/web/+ address-link.tsx, ~ index.ts
packages/shared/test/+ location.test.ts, web/+ address-link.test.tsx
backend/
├── prisma/~ schema.prisma, migrations/+ 20261011120000_venue_address_parts/migration.sql
├── src/
│   ├── address/+ address-geocoder.ts               # interface, token, result types, error
│   │          + census-geocoder.ts                 # the only real implementation (R1, R3, R6)
│   │          + address.module.ts
│   ├── locations/~ locations.module.ts, ~ locations.service.ts (R2, R7),
│   │             ~ dto/create-location.dto.ts, ~ dto/update-location.dto.ts (R8)
│   └── scripts/~ demo-data.ts                      # real addresses (R14)
└── test/
    ├── setup/+ fake-geocoder.ts; ~ test-app.ts, ~ fixtures.ts
    ├── unit/+ census-geocoder.spec.ts, + us-states.spec.ts
    └── integration/+ locations.address.e2e-spec.ts, + locations.address-edit.e2e-spec.ts,
                    + locations.legacy-address.e2e-spec.ts;
                    ~ every spec that posts a venue (address → four fields)
admin-app/src/pages/~ LocationForm.tsx, ~ LocationList.tsx, ~ LocationDetail.tsx
admin-app/src/components/~ ErrorBanner.tsx
admin-app/test/+ venue-address.test.tsx; ~ fixtures/locations.json, ~ venue-create.test.tsx,
               ~ other Location fixtures
customer-app/src/pages/~ VenueList.tsx, ~ VenueDetail.tsx
customer-app/test/+ address-link.test.tsx; ~ helpers.tsx
~ .env.example, ~ docker-compose.yml, ~ README.md
```

**Structure Decision**: the existing monorepo layout. The geocoder gets its own small module
(`backend/src/address/`) so `LocationsService` depends on an interface, not on HTTP. Everything
else sits next to the code it changes.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| An injected `AddressGeocoder` interface with one implementation | Tests must not use the network (Constitution VI), and the test app must swap it | Calling `fetch` inside `LocationsService` would force every venue test to mock `fetch` globally. |
| Request and response fields left out of `required` | The spec and plan PR merges before the implementation, and `main` must stay green and buildable (R11) | Required response fields fail the Backend's contract tests; required request fields fail the Admin app's `tsc` build. |
| A CHECK tying `address` to the parts | The one-line address and the parts must never disagree, whichever path writes them | Trusting the service alone leaves a direct write able to split them. |
| A stored `addressVerified` flag | Saved-anyway venues have parts but are not verified, so the state cannot be inferred | Inferring from `NULL` parts would show a saved-anyway venue as verified. |
| An internal `whenServiceUnavailable` option on `LocationsService.create` | `demo-data` must work on demo day without internet (R14) | Writing demo venues with `prisma` directly would skip every other venue rule. |
