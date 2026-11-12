# Tasks: Rust Admin App

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R12),
[data-model.md](./data-model.md), [contracts/sign-in-realm.md](./contracts/sign-in-realm.md),
[contracts/parity-checklist.md](./contracts/parity-checklist.md) (S1–S8, V1–V7, E1–E14, A1–A2,
R1–R3), [quickstart.md](./quickstart.md) (S0–S8). OpenAPI contract unchanged.

**Issue**: [#163](https://github.com/Trughouse-Holdings/QueuePass/issues/163). The implementation
PR's **description** says `fixes #163`. No commit message on either branch, and not the spec PR,
may contain "fixes #163", "closes #163", or "resolves #163". Cite it as plain `#163`.

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks
marked *(test first)* and see them **fail** before the tasks they cover. For a `core` port, the
React Admin app's own unit tests (`admin-app/test/`) are the reference cases: port each case, then
the code.

## Ground rules

- **Commits**: `Impl 037: <what> (T0xx–T0yy, #163)`; the body names the FR, R, or parity item.
- **Reference**: the React Admin app (`admin-app/src`) and its merged specs are the source of
  truth for behavior and wording. Use the same accessible names (labels, headings, button text) so
  the browser tests drive both apps (R10). Where the parity checklist and the React app disagree,
  follow the React app and fix the checklist in the impl PR.
- **Do not change** `admin-app/` or any Backend rule or endpoint. No OpenAPI change.
- **Do not touch** Mahdi's branches, including his Customer app Rust work.
- **Toolchain**: `rustup` with the toolchain from `admin-rust-app/rust-toolchain.toml`, plus
  `cargo install cargo-llvm-cov trunk --locked`.
- **Two pull requests** (Constitution III): this branch is the spec PR. Implementation is
  `037-rust-admin-app-impl`, cut from this branch and written in a fresh session from the spec and
  plan only. One independent review of each branch before it is asked to merge.
- **No merge, no push to `main`.** Each PR asks for review. The shared-surface files need every
  team member's approval.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

- [ ] T001 Cut `037-rust-admin-app-impl` from `037-rust-admin-app-spec`; `npm ci`; `npm test` on the untouched tree so later failures are this feature's
- [ ] T002 Create `admin-rust-app/` per plan: `Cargo.toml` (workspace members `core`, `app`), `rust-toolchain.toml` (current stable, `targets = ["wasm32-unknown-unknown"]`, `components = ["llvm-tools-preview", "rustfmt", "clippy"]`), edition 2024, `.gitignore` (`target/`, `dist/`, `coverage/`)
- [ ] T003 Create crate `admin-rust-app/core` (`admin-rust-core`, lib) and crate `admin-rust-app/app` (bin, depends on `core`) with the dependencies of plan Technical Context; `getrandom` with its WebAssembly (`js`/`wasm_js`) feature; `reqwest` with default TLS off for wasm
- [ ] T004 [P] Create `admin-rust-app/package.json` (`@queuepass/admin-rust-app`, private, no dependencies) with scripts `build` (`trunk build --release`), `test` (`cargo llvm-cov --package admin-rust-core --fail-under-lines 80 --lcov --output-path coverage/lcov.info`), `lint` (`cargo clippy --all-targets -- -D warnings`), `format:check` (`cargo fmt --check`) per R12; add `admin-rust-app` to root `package.json` `workspaces`
- [ ] T005 [P] Create `admin-rust-app/index.html` (`<title>QueuePass Admin (Rust)</title>`, Trunk links for the app crate and `style/theme.css`) and `admin-rust-app/Trunk.toml` (dev port 5176)
- [ ] T006 [P] Create `admin-rust-app/style/theme.css` with the red token block of R8 (accent `#b3261e`, page tint `#fdecea`, red header with white text, dark-scheme set), focus ring, error/success/notice styles, and seat-state styles with non-color cues

---

## Phase 2: Foundational (blocks every story)

### Realm, seed, Backend trust (contract sign-in-realm.md)

- [ ] T007 *(test first)* [P] In `packages/shared/test/realms.test.ts`, assert `APP_REALMS` has the row `{ app: 'admin-rust', realm: 'queuepass-admin-rust-app', clientId: 'admin-rust-app', role: 'queuepass-admin', prefix: 'admin', count: 5 }`, realms and client IDs are unique, and the seed and e2e copies equal it
- [ ] T008 *(test first)* [P] In `backend/test/`, auth tests for the new realm: valid `queuepass-admin` token from `queuepass-admin-rust-app` gets `200` on an admin endpoint; same realm with no role → `403`; with only `customer` or `gate-agent` → `403`; signed by another realm's key but claiming the new issuer → `401`; CORS preflight from `http://localhost:5176` allowed
- [ ] T009 *(test first)* [P] In `scripts/seed/test/`, provisioning tests: the `admin-rust-app` client is public, PKCE `S256` only, direct-access grants off, exact redirect URI and web origin for port 5176, `queuepass-api-audience` mapper, name `QueuePass Admin (Rust)`; realm has login theme `queuepass`; users `admin1`–`admin5` with `queuepass-admin`; a rerun converges with no duplicate
- [ ] T010 Add the `admin-rust` row to `APP_REALMS` and widen `AppRealmRow['app']` in `packages/shared/src/realms.ts`; update the import-free copies in `scripts/seed/src/app-realms.ts` and `e2e/fixtures/realms.ts`; find and fix any code that assumed one realm per role (grep every use of `APP_REALMS` and `Role`) (data-model)
- [ ] T011 Add `{ clientId: 'admin-rust-app', name: 'QueuePass Admin (Rust)', port: 5176 }` to `scripts/seed/src/provision-clients.ts` (R11)
- [ ] T012 Add `http://localhost:5176` to `CORS_ORIGINS` in `.env.example` and in `docker-compose.yml` wherever it is set; confirm T008 now passes
- [ ] T013 [P] *(test first)* Shared-theme contrast tests for a red sign-in accent set in `packages/shared/test/` (AA for text and controls in light and dark), then add the set to the sign-in token block of `packages/shared/src/web/theme.css` (Constitution VII, R8)
- [ ] T014 [P] Keycloak theme: map body class `qp-app--admin-rust-app` to the red sign-in set in `keycloak/themes/queuepass/login/resources/css/login.css`; add `qpAudience.admin-rust-app=For QueuePass staff, Rust version` to `keycloak/themes/queuepass/login/messages/messages_en.properties`; extend `scripts/seed/test/sign-in-screens.test.ts`

### Container and boundary

- [ ] T015 *(test first)* [P] In `scripts/test/`, a boundary test: `scripts/check-boundary.mjs` fails when `admin-rust-app/Cargo.toml` (or a member's) lists `sqlx`, `diesel`, `postgres`, `tokio-postgres`, `sea-orm`, or `prisma-client-rust`; then extend `scripts/check-boundary.mjs` (Principle I, R11)
- [ ] T016 [P] `admin-rust-app/Dockerfile`: build stage `rust:<pinned>` + `wasm32-unknown-unknown` + pinned `trunk`, dependency layer cached (build from `Cargo.toml`/`Cargo.lock` with stub sources first), copies `contracts/openapi.yaml`, `trunk build --release`; serve stage `nginx` with `admin-rust-app/nginx.conf` (SPA fallback to `index.html`, listen 5176), following `admin-app/Dockerfile` and `admin-app/nginx.conf`
- [ ] T017 Add service `admin-rust-app` to `docker-compose.yml`: build context and Dockerfile, `5176:5176`, `depends_on` `keycloak` and `backend` with `condition: service_healthy`, health check `GET /`; no service depends on it (FR-019); the build-time config (Keycloak URL, realm, client ID, API base) passed as the React Admin app's is
- [ ] T018 [P] `scripts/run-host.mjs`: start `trunk serve --port 5176` in `admin-rust-app/`; extend `scripts/test/run-host.test.mjs` and `scripts/test/e2e-ports.test.mjs` for port 5176
- [ ] T019 [P] `scripts/coverage-report.mjs`: read `admin-rust-app/coverage/lcov.info` and report its line coverage with the other workspaces; add `admin-rust-app` to the root `test` script after `@queuepass/admin-app`, and to `format:check` and `lint` (R12)

### `core` foundations

- [ ] T020 `admin-rust-app/core/build.rs`: run `typify` over `contracts/openapi.yaml` `components.schemas` (as `$defs`) into `OUT_DIR`; include as `core::api::types`; record any schema `typify` can't express and hand-write it in `core/src/api/types_manual.rs` (R5)
- [ ] T021 *(test first)* [P] `core/tests/contract_types.rs`: for each hand-written type, serialize a fixture and validate it with `jsonschema` against `components.schemas.<Name>`; for generated types, deserialize one example response per resource taken from `backend/test` fixtures or the contract's examples
- [ ] T022 *(test first)* `core/tests/api_client.rs` (`wiremock`): every call sends `Authorization: Bearer <token>`; a `4xx`/`5xx` with the contract error shape becomes `ApiError { status, code, message, details }`; a network failure becomes `Unreachable`; a non-JSON error body becomes a generic `ApiError`
- [ ] T023 `core/src/api/client.rs`: `ApiClient { base_url, token source }` over `reqwest`, `ApiError`, and one function per operation `admin-app/src/api/*.ts` calls (events, images, locations, orders, reports, seating, tiers, hello), same paths, methods, and bodies
- [ ] T024 *(test first)* [P] `core/tests/auth_state.rs`: the `AuthState` transitions of data-model.md (sign-in success with role → `SignedIn`; no `queuepass-admin` → `WrongRole`; renewal timing before expiry; refresh failure → `RenewFailed` → retry → `SignedIn`; refresh refused → `SigningIn`; sign-out from any signed state; Backend unreachable → `Unreachable`), mirroring `packages/shared/test` auth-provider cases
- [ ] T025 `core/src/auth/`: `AuthState` machine, token expiry and renewal schedule, role check from the access token's realm roles (data-model), no I/O
- [ ] T026 *(test first)* [P] `core/tests/time.rs`: port the cases of `admin-app/test/event-form-times.test.ts`, `format.test.ts`, `event-default-times.test.tsx`, and `event-form.tz.test.tsx`: venue-zone local ↔ instant, skipped local time refused with the React message, repeated time chosen by offset, display with the zone made clear, "next whole hour" and "+4 hours" defaults (036 FR-017), 15-minute doors steps 0–6 h
- [ ] T027 `core/src/time.rs` and `core/src/format.rs` (`chrono`, `chrono-tz`) passing T026 (R6)
- [ ] T028 *(test first)* [P] `core/tests/money.rs`: port the money cases of `admin-app/test/format.test.ts` and `fixtures-005.ts` for `money.ts` (parsing, exact cents, USD formatting); then `core/src/money.rs` (no floating point)

### App shell (User Story 1's frame, used by every story)

- [ ] T029 `app/src/oidc_glue.rs`: `openidconnect` discovery against `{KEYCLOAK}/realms/queuepass-admin-rust-app`, authorization-code request with PKCE `S256` (verifier and `state` in `sessionStorage` only across the redirect, removed at once after the exchange), code exchange, ID-token validation, refresh grant, RP-initiated logout via `end_session_endpoint`, driving `core::auth` (R3)
- [ ] T030 `app/src/shell.rs` and `app/src/main.rs`: Leptos app with the red header ("QueuePass Admin (Rust)", nav Venues, Events, Reports, signed-in username, Sign out), wrong-role page, unreachable page, and the `/` home page showing `/hello/admin` (parity S1–S7); `app/src/routes.rs` with every route of `admin-app/src/App.tsx`
- [ ] T031 [P] `app/tests/web.rs` (`wasm-bindgen-test`, headless Chrome): after a fake code exchange no PKCE value is left in `sessionStorage`; tokens are never written to `localStorage` or `sessionStorage`

**Checkpoint**: `docker compose up --build` brings up `admin-rust-app`; sign-in, home page, and sign-out work in the Rust Admin app.

---

## Phase 3: User Story 1 — Sign in next to the React app (P1) 🎯 MVP

**Goal**: both Admin apps signed in at once; Rust is red and named; signing out of one leaves the other.
**Independent test**: quickstart S1.

- [ ] T032 *(test first)* [US1] `e2e/fixtures/apps.ts`: add `adminRust: { url: 'http://localhost:5176', name: 'QueuePass Admin (Rust)', role: 'admin' }`; add an `adminApp` Playwright fixture that resolves to `APPS.admin` by default and to `APPS.adminRust` in project `admin-rust`; add project `admin-rust` to `e2e/playwright.config.ts` running tests tagged `@admin` (R10)
- [ ] T033 *(test first)* [US1] `e2e/tests/037-rust-admin-app.spec.ts`: test `037 S1: both Admin apps stay signed in, and signing out of one leaves the other` (sign in to both in one context, red sign-in heading "Sign in to QueuePass Admin (Rust)", header and tab title contain "(Rust)", sign out of Rust then React still signed in after reload, and the reverse)
- [ ] T034 [US1] Extend `e2e/tests/028-app-realms.spec.ts` with the Rust Admin app as a fourth app in the one-window scenario
- [ ] T035 [US1] Make T033 and T034 pass (fix shell, glue, seed, or theme as needed); confirm the red header and page tint meet AA with an axe check in T033
- [ ] T036 [US1] Tag every Admin-only journey in `e2e/tests/` `@admin` and switch it from `APPS.admin` to the `adminApp` fixture (files 001, 002, 003, 020, 024, 025, 030, 031, 035, 036 and the Admin parts of 015, 016, 032 if present); leave untagged, with a comment, any step that checks the React app's own code

**Checkpoint**: User Story 1 shippable. Commit, and keep going.

---

## Phase 4: User Story 2 — Venues and their seating (P1)

**Goal**: parity items V1–V7. **Independent test**: quickstart S2.

- [ ] T037 *(test first)* [P] [US2] `core/tests/venue_form.rs`: port the cases of `admin-app/test/section-lines.test.tsx` and `layout.test.tsx` and the venue-form checks (Rows × Seats per row, line seat count, capacity), state and ZIP rules, and the time zone list
- [ ] T038 [P] [US2] `core/src/forms/venue.rs` and `core/src/forms/section_lines.rs` passing T037
- [ ] T039 [US2] `app/src/pages/venue_list.rs`: table (Name, Address, Seating capacity, Time zone), search "Name or address, such as a city", empty state "No venues yet", load error "Could not load venues" (V1)
- [ ] T040 [US2] `app/src/pages/venue_form.rs` and `app/src/components/section_lines.rs`: create and edit, all fields of V2, one-step save with verified or not-verified outcome (V3), Backend refusals beside their field with values kept (V4)
- [ ] T041 [US2] `app/src/pages/venue_detail.rs`: V5 (address with Google Maps link as `packages/shared/src/web/address-link.tsx`, "Not verified" note, time zone, capacity, Events here with past hidden and toggle, "Nothing is scheduled here.") and V7 (delete with confirmation, "Could not delete", "This venue no longer exists.")
- [ ] T042 [US2] `app/src/components/layout_card.rs`: change the layout (Section, Size, Seats), "Could not change the layout" with the reason (V6)
- [ ] T043 [US2] `e2e/tests/037-rust-admin-app.spec.ts`: test `037 S2: a venue made in the Rust Admin app shows in the React Admin app`; run `003` and `024` in project `admin-rust` and make them pass

---

## Phase 5: User Story 3 — Schedule and edit events (P1)

**Goal**: parity items E2–E8. **Independent test**: quickstart S3.

- [ ] T044 *(test first)* [P] [US3] `core/tests/event_form.rs`: port every case of `admin-app/test/event-form-checks.test.ts`, `event-form-flow.test.tsx`, `event-doors-open.test.tsx`, `capacity.test.tsx`, and `event-types-edit.test.tsx` (each field check and message, when it shows: on leaving then as typed; first field at fault; seat totals per type and overall against the layout or total tickets; doors modes and switching keeps the instant; locked controls when tickets are sold)
- [ ] T045 [US3] `core/src/forms/event.rs`: `EventFormState` of data-model.md ("each field's local value (`YYYY-MM-DDTHH:mm` per time field, as in 036), doors mode, ticket types, section-to-type map, limit, pending images, touched fields") and the checks and totals, passing T044
- [ ] T046 [US3] `core/src/api/events.rs` request builders: one all-or-nothing create (event, ticket types, seating; `031`) and the existing update request (`035`); map `ApiError.details` to the form field it names; tests in `core/tests/api_client.rs`
- [ ] T047 [US3] `app/src/pages/event_form.rs` section Venue and times (E2): venue select, name, Starts and Ends as date + time controls in the venue zone, doors open two modes, defaults for a new event
- [ ] T048 [US3] Section Tickets and seating (E3): total tickets or reserved seating, ticket types add/remove, section → type or Not for sale, live totals announced politely
- [ ] T049 [US3] Section Details (E4): tickets per customer (No limit or a number); `app/src/components/images_field.rs` (Add images, up to 5, move earlier and later, remove)
- [ ] T050 [US3] Submit and refusals (E5–E7): never send a known problem, focus first field at fault, save all or nothing, then upload pictures in order with a per-picture failure message, Backend refusal beside its field and focused, values kept
- [ ] T051 [US3] Edit mode (E8): load the event, lock controls with the reason when tickets are sold, save through the update request
- [ ] T052 [US3] Run `031`, `035`, `036`, `025`, `020` in project `admin-rust` and make them pass

---

## Phase 6: User Story 4 — Events, sales, and seats (P2)

**Goal**: parity items E1, E9–E14. **Independent test**: quickstart S4.

- [ ] T053 *(test first)* [P] [US4] `core/tests/seat_stream.rs`: parse the seat stream's framing as `packages/shared/src/web/seat-stream.ts` does (snapshot then changes), map to `SeatState` (`Open`, `Held`, `Sold`), and signal reconnect when the server ends the stream; then `core/src/api/seat_stream.rs`
- [ ] T054 [US4] `app/src/pages/event_list.rs`: E1 (columns, name/venue/From–To filters with "From must be on or before To.", Show past events with Ended, Cancelled, the three empty states, "Could not load events")
- [ ] T055 [US4] `app/src/pages/event_detail.rs`: E9 (details, status, image gallery as `packages/shared/src/web/image-gallery.tsx` behaves) and E14 (cancel and delete with confirmation, "Could not cancel", "Could not delete", "This event no longer exists.")
- [ ] T056 [P] [US4] `app/src/components/tiers.rs` (E10) and `app/src/components/sales_card.rs` (E11)
- [ ] T057 [US4] `app/src/components/seating_card.rs` (E12) and `app/src/components/seat_grid.rs` + `app/src/seat_stream.rs` (E13: streaming `fetch` with `Authorization` header, live updates, reconnect at token expiry, "Row r, Seat s" names with sold/held/open told apart without color)
- [ ] T058 [US4] Run `002`, `015`, `016`, `030` (Admin parts) in project `admin-rust` and make them pass

---

## Phase 7: User Story 5 — Attendees, reports, downloads (P2)

**Goal**: parity items A1–A2, R1–R3. **Independent test**: quickstart S5.

- [ ] T059 *(test first)* [P] [US5] `core/tests/export_rows.rs`: port the cases in `admin-app/test/export/`, `attendees-export.test.tsx`, and `reports-export.test.tsx` for `attendee-rows`, `sales-rows`, `table`, `made`, `file-name`. Add input fixtures `core/tests/fixtures/export/*.json` and the React app's output for them (rows, and the CSV text) in `core/tests/fixtures/export/expected/`, made once by a new script `scripts/export-parity-fixtures.mjs` that imports `admin-app/src/export/*.ts` without changing it; the Rust output must equal it (SC-004)
- [ ] T060 [US5] `core/src/export/{rows,table,made,file_name}.rs` passing T059
- [ ] T061 *(test first)* [P] [US5] `core/tests/export_files.rs`: CSV equals the React CSV for each fixture byte for byte except the made-at line; XLSX (read back with `calamine` as a dev-dependency) has the same cells and typed numbers, dates, and money; PDF text (extracted with `lopdf` as a dev-dependency) has the title, made-at line, header, and every row
- [ ] T062 [US5] `core/src/export/{csv,xlsx,pdf}.rs` (`csv`, `rust_xlsxwriter` `wasm` feature, `printpdf` with a repeated-header table layout) passing T061 (R7)
- [ ] T063 [US5] `app/src/download.rs` (Blob + temporary `download` link, as `admin-app/src/export/save.ts`) and `app/src/components/export_menu.rs` (CSV, XLSX, PDF; group label as the React `ExportMenu`)
- [ ] T064 [US5] `app/src/pages/attendees.rs` (A1, A2: "Attendees: <event>", columns, "Check-in details removed on …", Download the attendee list)
- [ ] T065 [US5] `app/src/pages/reports.rs` (R1, R2: Revenue, Tickets sold with meter, Checked in with meter, Scheduled events, By event table with % sold, Download the sales report)
- [ ] T066 [US5] Run the Admin parts of `023`/`032` journeys, if present, in project `admin-rust`; add to `037-rust-admin-app.spec.ts` a check that each download link produces a file with the expected name

---

## Phase 8: Polish and cross-cutting

- [ ] T067 [P] `.github/workflows/ci.yml`: in `test`, install the toolchain from `admin-rust-app/rust-toolchain.toml`, `cargo-llvm-cov` and `trunk` (pinned, via a cached install), cache `~/.cargo` and `admin-rust-app/target`; in `e2e`, the compose stack builds `admin-rust-app` and both Playwright projects run
- [ ] T068 [P] `README.md`: Rust Admin app URL `http://localhost:5176`, same admin accounts, `rustup` and `cargo install cargo-llvm-cov trunk --locked` for host builds and tests, first Docker build takes minutes
- [ ] T069 `npm run format:check`, `npm run lint`, `npm run build`, `npm test` (admin-rust-app ≥ 80% lines on `core`; the coverage exclusion of `app` listed with its reason in `admin-rust-app/package.json` or a `coverage.md` per Principle VI), `npm run e2e` all green
- [ ] T070 Parity walk: go through `contracts/parity-checklist.md`, tick every item E/U/M in the impl PR description; fix the checklist where the React app differs
- [ ] T071 Running-system gate from a fresh clone: `docker compose up --build`, seed succeeds first time, sign in / use / sign out in all four front ends; record the date
- [ ] T072 Update `quickstart.md` Automation rows S1 and S2 to Automated with their exact test titles; `node scripts/check-quickstart-marks.mjs` passes
- [ ] T073 Independent review by a Claude session that did not write the implementation; fix findings; record the review in the impl PR description; open the PR only after the spec PR is merged, with `fixes #163` in its description

---

## Dependencies

- Phase 1 → Phase 2 → every story.
- US1 (Phase 3) is the MVP and needs only Phase 2. T036 (tagging the journeys) is needed before
  the "run in `admin-rust`" tasks T043, T052, T058, T066.
- US2 → US3 (the event form needs venues with layouts to pick). US4 and US5 need events, so they
  come after US3, but they are independent of each other.
- Phase 8 after all stories.

## Parallel examples

- Phase 2: T007, T008, T009, T013, T014, T015, T016 together (different files); then T020–T028 in
  `core` with each test task in parallel with other areas' tests.
- US2: T037/T038 (core) in parallel with T039 (list page).
- US4 and US5 can run side by side once US3 is done: T053–T058 and T059–T066.
- Within US5: T059 and T061 (tests) in parallel; T060 and T062 after.

## Implementation strategy

1. **MVP**: Phases 1–3. The Rust Admin app is up, red, signed in beside the React app, signed out
   independently. It is a constitution "stub front end" and safe to demo.
2. Add venues (US2), then events (US3): the app is now usable for real admin work.
3. Add the read-only pages and the live seat map (US4), then attendees, reports, downloads (US5):
   full parity.
4. Polish: CI, README, parity walk, fresh-clone gate, review, PR.
