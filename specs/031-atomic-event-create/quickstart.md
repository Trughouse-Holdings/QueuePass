# Quickstart: All-or-Nothing Event Scheduling

**Feature**: `031-atomic-event-create` | **Spec**: [spec.md](./spec.md)

The running-system gate for this feature. Walk it against a stack built from the implementation
branch, on its own Compose project (`-p qp031`), or on path B with Mahdi's go for the team stack's
ports. Each scenario names the requirements it proves. Open the browser's network panel for S1 to
S5: each schedule should be one `POST /events` (plus one request per picture).

## S0. A stack of its own, with two venues

1. Path A: `docker compose -p qp031 up --build`, then `docker compose -p qp031 exec backend node
   backend/dist/scripts/demo-data.js` (README "Demo data"). Path B (this
   machine): the team's stack (Compose project `queuepass-team`) holds the ports. **Ask Mahdi before
   touching it.** With his go: stop its `run-host.mjs` (Ctrl+C in its terminal) and `docker compose
   -p queuepass-team stop` (never `down`, never `-v`); then `docker compose -p qp031 up -d database
   keycloak` and `node scripts/run-host.mjs --demo-data`.
2. Sign in to the Admin app as `admin1`. **Expected**: Demo Riverside Hall (no layout) and QueuePass
   Demo Arena (a layout with sections) are listed.

## S1. A general-admission event, whole (US1, US3; FR-001, FR-003, FR-008, SC-004)

1. Schedule event: name "031 General", Demo Riverside Hall, a free slot two weeks ahead, ticket types
   Floor $80 × 300 and Balcony $60 × 200. Schedule event.
2. **Expected**: one `POST /events` whose body has `tiers` with both types and their quantities; no
   `POST …/tiers`; the event page opens with both ticket types.

## S2. A seated event, whole (US2; FR-001, FR-004, FR-008)

1. Schedule event at QueuePass Demo Arena, a free slot, reserved seating, ticket types Front $120 and
   Standard $70; the first section sells Front, the others Standard, the last set to Not for sale if
   there are three or more.
2. **Expected**: one `POST /events` with `reservedSeating: true` and each type's `sectionIds`; no `PUT
   …/seating`; the event page shows reserved seating, the capacity the layout's total, Front with the
   first section's seats, Standard with the rest but the unsold one; the seat map shows each section's
   type.

## S3. A refused ticket type saves nothing (US1; FR-003, FR-006, FR-009, FR-010, SC-001, SC-002, SC-003)

1. Schedule event: name "031 Refused", Demo Riverside Hall, a free slot, ticket types Floor $80 × 300
   and `floor` $60 × 200, and choose a picture. Schedule event.
2. **Expected**: the error banner and, beside ticket type 2, a message that it has the same name as
   ticket type 1; ticket type 2's inputs are marked invalid; every value, the picture included, is
   still in the form; no picture request was sent; the Events list has no "031 Refused".
3. Rename ticket type 2 to Balcony and schedule again. **Expected**: the event opens with both types
   and its picture; the Events list has exactly one "031 Refused"; no scheduling conflict.

## S4. Ticket types over capacity, and a bad section (US1, US2; FR-004, FR-010)

1. Schedule at Demo Riverside Hall with Total tickets 400 and types A × 300 and B × 200.
   **Expected**: the error beside the ticket types, naming 400 and 600; nothing saved.
2. In the Admin app, open QueuePass Demo Arena's venue page in a second tab and keep the Schedule
   event form open in the first, with reserved seating and sections chosen. In the second tab, save
   the venue's layout with a section renamed (new sections, new ids). Back in the first tab, Schedule
   event. **Expected**: refused, the message beside the ticket type whose section is gone, saying to
   reload the form; nothing saved. Reload the form and schedule: saved.

## S5. A scheduling conflict with ticket types (US1, US3; FR-003, FR-007)

1. Schedule an event with ticket types in the same slot as S1's "031 General". **Expected**: the
   conflict banner naming "031 General", as today; nothing saved, no extra ticket types anywhere
   (Admin: "031 General" still has exactly its two types).

## S6. No answer (FR-011)

1. Path B: stop the Backend (Ctrl+C on `run-host.mjs`, or stop only its process); path A: `docker
   compose -p qp031 stop backend`. Fill the form and Schedule event.
2. **Expected**: the banner says there was no answer, the event may or may not have been scheduled,
   and to check the Events list (a link) before scheduling again; every value stays. Start the Backend
   again and follow the link: no new event. Schedule: saved once.

## S7. Pictures as before (FR-012)

1. Schedule a valid event with two pictures, the second one too large (over the limit `014` sets).
2. **Expected**: "Event created. These pictures were not added: …", and the form becomes the new
   event's edit form with the second picture pending; the event has its ticket types and seating.
   Nowhere does "Seating setup not finished" appear.

## S8. Through the API (US3; FR-002, FR-005, FR-006)

1. With an admin token (README "How sign-in works": copy one from the signed-in Admin app), `POST
   /events` with S1's body, another name and slot, and no `tiers`.
   **Expected**: `201`, an event without ticket types, as before this feature.
2. `POST /events` with `tiers` having a price `80.001` and an empty name. **Expected**: `400
   VALIDATION_FAILED` listing both, each starting `tiers.<i>.`; no event.
3. `POST /events` with `reservedSeating: true` at Demo Riverside Hall. **Expected**: `400`, the
   message starting `reservedSeating`; no event.

## S9. Editing unchanged (FR-013)

1. Edit "031 General": rename Balcony, add a type, save. **Expected**: as before this feature: saved,
   through the same requests as before (`PATCH /events/{id}`, `POST`/`PATCH …/tiers`).

## S10. Sign in, use, sign out (Constitution VI)

Sign in to each front end, use it briefly, and sign out. **Expected**: as before `031`. In the
Customer app, the events made in S1 to S3 show with their ticket types; "031 Refused" shows only
once. Afterwards `docker compose -p qp031 down -v` removes this stack. On path B, restore the team's
stack: `docker compose -p queuepass-team start database keycloak` (only those two) and its
`run-host.mjs` from the main checkout.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`. The Backend's rules, the rows left behind,
and concurrency are covered by the Backend's integration tests against real PostgreSQL (tasks T002
to T005); the form by the Admin app's tests (T006, T007).

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: setup by hand; the browser tests make their own venue and events through the API |
| S1 | Manual: scheduling a general-admission event is `003`'s browser test, which now sends the one request; the request's body is checked by the Admin app's tests (T006) |
| S2 | Manual: the seated schedule's rows are checked by the Backend's tests (T002) and its request by the Admin app's (T006) |
| S3 | Automated: `031 S3: a refused ticket type on Schedule shows its error beside it, keeps the form filled, and creates no event` |
| S4 | Manual: two tabs and a layout change by hand; both refusals are in the Backend's tests (T003, T005) and their placement in the Admin app's (T006) |
| S5 | Manual: the conflict with ticket types is in the Backend's tests (T003, T005); the conflict banner is `002`'s |
| S6 | Manual: stopping the Backend would break the browser tests running beside it; the message is in the Admin app's tests (T006) |
| S7 | Manual: an oversized picture by hand; `014`'s Admin tests cover the notice (T007 keeps them) |
| S8 | Manual: API calls by hand; covered by the Backend's integration tests (T002, T003) |
| S9 | Manual: editing is unchanged; `008`'s Admin tests cover it |
| S10 | Manual: sign in, use, and sign out of each front end, by hand; the main journeys are `022`'s browser tests |
