# Implementation Plan: Venue Form Simplify

**Branch**: `024-venue-form-simplify-spec` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#107](https://github.com/Trughouse-Holdings/QueuePass/issues/107)

**Input**: Feature specification from `specs/024-venue-form-simplify/spec.md`

## Summary

- **The admin picks the time zone** (research R1–R3): `LocationForm`'s Time zone select lists the
  eight zones only; on create it starts on "Choose a time zone" and the form refuses to send without
  one ("Choose the venue's time zone."); on edit it starts on the stored zone with how it was set, and
  says an address change does not change it. The zone is sent on every create; on an edit the address
  is sent only when it changed or is not verified, always with the zone shown, which the form says is
  then recorded as chosen by an admin; otherwise the zone only when the admin picked another (R3). The
  split-state question goes. The API keeps `timeZone`
  optional and keeps working the zone out for other callers (R2).
- **One press saves the address** (R4–R7): the Admin app sends `acceptUnverifiedAddress: true` with
  every address; the Save anyway button goes. The Backend's flag now also covers the address service
  being down (one branch in `checkAddress`, R5), and an edit that resends a not-verified venue's same
  address with the flag checks it again, upgrading it on a match (re-read under the venue lock) and
  never refusing; without the flag, nothing changes (R7). After a not-verified save,
  a plain information notice says so, why it matters, and how to verify it later (R6).
- **Labelled section lines** (R8): `SectionLines` (used by the New venue form and the venue page's
  layout editor) shows "Section name", "Rows × Seats per row", the line's "= N seats", and one hint;
  each box's name is its legend plus its visible label.
- **Contract 1.15.0** (R5, contracts/README.md): descriptions only; `api-schema.ts` regenerated in
  this PR.
- **Browser tests** (R10, R11): `e2e/tests/024-venue-form.spec.ts` (two tests) and one outage street
  in the address stand-in; `003 C1` picks its zone.
- **Constitution 3.6.1** (R13): the `024` roadmap row, in this PR. `013`'s and `020`'s specs and
  quickstarts get a one-line "Superseded in part by `024`" note (R12).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22 LTS; React 19 and Vite 6 (Admin app);
NestJS 11 and Prisma 6 (Backend).

**Primary Dependencies**: none new. `@queuepass/shared` (`US_TIME_ZONES`, `zoneName`, `ZIP_PATTERN`,
the generated API types); Playwright for the browser tests (`022`).

**Storage**: PostgreSQL 17; no schema change, no migration (data-model.md).

**Testing**: Jest with Testcontainers PostgreSQL and the integration tests' fake address service
(Backend); Vitest with React Testing Library and the stubbed API (Admin app); Playwright against the
`qpe2e` Compose stack with the address stand-in (`npm run e2e`). Research R15.

**Target Platform**: the Admin app in desktop browsers and at phone width (360 px), light and dark;
the Backend in the Compose stack.

**Project Type**: web application (Backend and Admin front end; the Customer and Ticket Booth apps
are untouched).

**Performance Goals**: a save while the address service is down completes within 6 seconds (SC-003;
the service's 5-second limit is unchanged).

**Constraints**: Constitution I (contract first: the 1.15.0 descriptions in this PR), IV (the Backend
still decides verification; the form's zone check is a convenience over an optional field, R1), VII
(shared theme values only; `012`'s drift check), VIII (no new operation, no new flag, R2, R5).

**Scale/Scope**: two Admin components and one page, one Backend service method pair, one contract
version, two browser tests and one stand-in rule, six test files.

## Constitution Check

*GATE: checked before research and again after design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | 1.15.0 in this PR: descriptions of `createLocation`, `updateLocation`, `Location`, `LocationInput.timeZone`, `AcceptUnverifiedAddress`, `AddressServiceUnavailable`; `api-schema.ts` regenerated; drift check passes; no shape change | Pass |
| II. One command | No new service, variable, or setup; the stand-in change is inside the browser-test stack | Pass |
| III. Spec-driven | Spec + plan PR with the constitution row, independent review, fresh implementer; commits cite `024` and #107; `fixes #107` only in the implementation PR's description. The spec PR changes shared surface (`.specify/memory/constitution.md`, `contracts/openapi.yaml`, `packages/shared/src/api-schema.ts`), so it needs every team member's approval (Constitution, Feature Roadmap); the implementation PR touches none | Pass |
| IV. Server-authoritative | The Backend still checks every new or changed address and alone decides `addressVerified` (`013` FR-018); refusals still shown with values kept; the re-check never refuses (R7) | Pass |
| V. Least privilege | No operation or role change; both operations stay `queuepass-admin` | Pass |
| VI. Test-first, browser tests | Backend, Admin app, and browser tests written first and seen to fail (R15); the quickstart's Automation table marks every scenario, Automated rows added with the tests (R11) | Pass |
| VII. Shared look | `.field`, `.field__hint`, `.form__row`, `.banner`, `.note` only; a new `.form__row--section` modifier in `admin-app/src/styles.css` with theme values, `.form__row` itself unchanged (it also lays out the event form's ticket types and the tier mapping) | Pass |
| VIII. Simplicity | API keeps `timeZone` optional (R2); the existing flag widened instead of a new one (R5); demo data untouched (R9); no deferral of a control | Pass |

Post-design: unchanged, all pass. Constitution amended to 3.6.1 (PATCH, roadmap row only).

## Project Structure

### Documentation (this feature)

```text
specs/024-venue-form-simplify/
├── spec.md, plan.md, research.md (R1–R15), data-model.md, quickstart.md (V0–V10)
├── contracts/README.md          # 1.14.0 → 1.15.0, descriptions only
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
contracts/openapi.yaml                         # 1.15.0 (this PR)
packages/shared/src/api-schema.ts              # regenerated (this PR)
.specify/memory/constitution.md                # 3.6.1, the 024 row (this PR)
specs/013-venue-address-validation/{spec,quickstart}.md   # "Superseded in part by 024" (this PR)
specs/020-venue-time-zones/{spec,quickstart}.md           # the same (this PR)

backend/
├── src/locations/locations.service.ts         # checkAddress: the flag covers unavailable (R5);
│                                              # update: re-check a not-verified same address (R7)
└── test/integration/
    ├── locations.address.e2e-spec.ts          # create: unavailable with and without the flag
    └── locations.address-edit.e2e-spec.ts     # edit: unavailable with the flag; the re-check
admin-app/
├── src/pages/LocationForm.tsx                 # the select, the required zone, the flag, the notice;
│                                              # Save anyway and the split-state question removed
├── src/components/SectionLines.tsx            # labels, ×, the line's seats, the hint, names
├── src/styles.css                             # .form__row--section (new), phone-width wrap
└── test/
    ├── venue-time-zone.test.tsx, venue-address.test.tsx   # rewritten for R1–R4, R6
    ├── section-lines.test.tsx                 # new
    └── venue-create.test.tsx, layout.test.tsx # new box names, a zone chosen
e2e/
├── stack/geocoder-stub/server.mjs             # 0 Outage Way → 503 (R10)
├── fixtures/data.ts                           # UNKNOWN_PLACE, OUTAGE_PLACE
└── tests/
    ├── 024-venue-form.spec.ts                 # new: 024 V1/V2/V3, 024 V4/V5
    └── 003-venue-event.spec.ts                # chooses Eastern Time before Create venue
specs/024-venue-form-simplify/quickstart.md    # Automation rows V1–V5 → Automated (R11)
README.md                                      # the 024 row; Save anyway and "worked out" text (R14)
```

**Structure Decision**: the change stays where each behavior already lives: the form in the Admin
app's venue page and its shared section component, the address rule in `LocationsService`, the
browser tests in `e2e/`. No new module is shared between apps, since only the Admin app edits venues.
Inside the Admin app, `SectionLines` is already shared by the New venue form and the layout editor,
and `.form__row` by them, the event form's ticket-type lines, and the tier mapping: the section
layout goes in a modifier so the other two keep theirs (research R8).

## Complexity Tracking

None.
