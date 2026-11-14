# Tasks: Rust Admin App

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R12),
[data-model.md](./data-model.md), [contracts/sign-in-realm.md](./contracts/sign-in-realm.md),
[contracts/parity-checklist.md](./contracts/parity-checklist.md) (shell S1–S10, venues V1–V7,
events E1–E14, attendees and reports A1–A2, R1–R3, exports X1–X5), [quickstart.md](./quickstart.md)
(S0–S9). OpenAPI contract unchanged.

**Issue**: [#163](https://github.com/Trughouse-Holdings/QueuePass/issues/163). The implementation
PR's **description** says `fixes #163`. No commit message on either branch, and not the spec PR,
may contain "fixes #163", "closes #163", or "resolves #163". Cite it as plain `#163`.

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks
marked *(test first)* and see them **fail** before the tasks they cover. For a `core` port, the
React Admin app's own tests (`admin-app/test/`) and the shared package's tests
(`packages/shared/test/`) are the reference cases: port each case, then the code.

## Ground rules

- **Commits**: `Impl 037: <what> (T0xx–T0yy, #163)`; the body names the FR, R, or parity item.
- **Reference**: the React Admin app (`admin-app/src`), the shared web code it uses
  (`packages/shared/src/web/`), and the merged specs are the source of truth for behavior and
  wording. Use the same accessible names (labels, headings, button text, for example "Log out") so
  the browser tests drive both apps (R10). Where the parity checklist and the React app disagree,
  follow the React app and fix the checklist in the impl PR.
- **Do not change** `admin-app/` or any Backend rule or endpoint. No OpenAPI change.
- **Do not touch** Mahdi's branches, including his Customer app Rust work.
- **Toolchain**: `rustup`, then `npm run rust:setup` once T004 exists.
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
- [ ] T002 Create `admin-rust-app/` per plan: `Cargo.toml` (workspace members `core`, `app`), `rust-toolchain.toml` (current stable, `targets = ["wasm32-unknown-unknown"]`, `components = ["llvm-tools-preview", "rustfmt", "clippy"]`), edition 2024, `.gitignore` (`target/`, `dist/`, `coverage/`), `.cargo/config.toml` with the `getrandom` WebAssembly backend cfg if the pinned `getrandom` is 0.3 (R3); add `**/target/` to `.dockerignore`, `.prettierignore`, and the `ignores` of `eslint.config.mjs` (R11)
- [ ] T003 Create crate `admin-rust-app/core` (`admin-rust-core`, lib) and crate `admin-rust-app/app` (bin, depends on `core`) with the dependencies of plan Technical Context; `reqwest` with default TLS off for wasm; `printpdf` pinned to one minor version
- [ ] T004 *(test first)* [P] `scripts/test/rust-setup.test.mjs`: `scripts/rust-setup.mjs` runs `rustup show` in `admin-rust-app/`, and installs pinned prebuilt `trunk` and `cargo-llvm-cov` into `~/.cargo/bin` only when missing or at another version; then write `scripts/rust-setup.mjs` and root script `"rust:setup": "node scripts/rust-setup.mjs"`, and put `npm run rust:setup` in the root `ci` script right after `prisma:generate` (R12)
- [ ] T005 [P] Create `admin-rust-app/package.json` (`@queuepass/admin-rust-app`, private, no dependencies) with scripts `build` (`trunk build --release`), `test` (`cargo llvm-cov --package admin-rust-core --fail-under-lines 80 --json --summary-only --output-path coverage/llvm-cov.json && node scripts/coverage-summary.mjs`), `lint` (both clippy commands of R9), `format:check` (`cargo fmt --check`), and a `coverage` note naming the `app` crate exclusion and its reason (Constitution VI); add `admin-rust-app` to root `package.json` `workspaces`
- [ ] T006 [P] Create `admin-rust-app/index.html` (`<title>QueuePass Admin (Rust)</title>`, Trunk links for the app crate and `style/theme.css`) and `admin-rust-app/Trunk.toml` (dev port 5176)
- [ ] T007 [P] Create `admin-rust-app/style/theme.css` with the red token block of R8 (accent `#b3261e`, page tint `#fdecea`, red header with white text, dark-scheme set), focus ring, error, success, and notice styles, a distinct scheduling-conflict banner style (parity S9), and seat-state styles with non-color cues

---

## Phase 2: Foundational (blocks every story)

### Realm, seed, Backend trust (contract sign-in-realm.md)

- [ ] T008 *(test first)* [P] `packages/shared/test/realms.test.ts`: assert the new row `{ app: 'admin-rust', realm: 'queuepass-admin-rust-app', clientId: 'admin-rust-app', role: 'queuepass-admin', prefix: 'admin', count: 5 }`; change the realm count to 4, "roles equal `QUEUEPASS_ROLES`" to "every row's role is in `QUEUEPASS_ROLES`, and every role has a row", and the account total 235 to 240; realms and client IDs unique; the seed and e2e copies equal the table
- [ ] T009 *(test first)* [P] `backend/test/integration/auth.realms.e2e-spec.ts`: confirm the `APP_REALMS`-driven cases now include the new realm and add any missing: valid admin token → `200` on an admin endpoint; no role → `403`; only `customer` or `gate-agent` → `403`; another realm's key claiming the new issuer → `401`; expired → `401`; wrong audience → `401`. `backend/test/integration/cors-docs.e2e-spec.ts`: preflight from `http://localhost:5176` allowed
- [ ] T010 *(test first)* [P] Seed tests: `scripts/seed/test/clients.unit.test.ts` (`PORTS` gains 5176), `scripts/seed/test/provision-clients.test.ts` (the `admin-rust-app` client is public, PKCE `S256` only, direct-access grants off, exact redirect URI and web origin for 5176, `queuepass-api-audience` mapper, name `QueuePass Admin (Rust)`), provisioning tests for realm login theme `queuepass` and users `admin1`–`admin5` with `queuepass-admin`, and a rerun converging with no duplicate
- [ ] T011 Add the `admin-rust` row to `APP_REALMS` and widen `AppRealmRow['app']` in `packages/shared/src/realms.ts`; update the import-free copies in `scripts/seed/src/app-realms.ts` and `e2e/fixtures/realms.ts`; update `EXPECTED_COUNTS` and the 235 comments in `scripts/seed/src/provision-users.ts`; grep every other use of `APP_REALMS` and `Role` for a one-realm-per-role assumption and fix it (leave `backend/src/hello/hello.controller.ts` as it is, R11)
- [ ] T012 Add `{ clientId: 'admin-rust-app', name: 'QueuePass Admin (Rust)', port: 5176 }` to `scripts/seed/src/provision-clients.ts` (R11)
- [ ] T013 Add `http://localhost:5176` to `CORS_ORIGINS` in `.env.example`, `docker-compose.yml` (wherever set), `scripts/run-host.mjs`, `backend/test/setup/test-app.ts`, and `backend/test/integration/cors-docs.e2e-spec.ts`; confirm T009 now passes
- [ ] T014 [P] *(test first)* Red sign-in accent set: extend `packages/shared/test/contrast.test.ts`, `tokens.test.ts`, and `drift.test.ts` for a fourth app, then add the full seven-role set (accent, hover, soft, text, brand-mark-end, brand-mark-text, stone-accent; light and dark) to the sign-in token block of `packages/shared/src/web/theme.css`, so `check-theme.ts` passes (Constitution VII, R8, R11)
- [ ] T015 [P] Keycloak theme: map body class `qp-app--admin-rust-app` to the red set in `keycloak/themes/queuepass/login/resources/css/login.css`; add `qpAudience.admin-rust-app=For QueuePass staff, Rust version` to `keycloak/themes/queuepass/login/messages/messages_en.properties`; extend `scripts/seed/test/login-theme-files.test.ts` and `scripts/seed/test/sign-in-screens.test.ts`; in `e2e/tests/027-sign-in-background.spec.ts`, expect four line colours and add the fourth `AUDIENCE` entry

### Container, configuration, boundary, coverage

- [ ] T016 *(test first)* [P] `scripts/test/` boundary test: `scripts/check-boundary.mjs` fails when any of `admin-rust-app/Cargo.toml`, `core/Cargo.toml`, `app/Cargo.toml` lists `sqlx`, `diesel`, `postgres`, `tokio-postgres`, `sea-orm`, or `prisma-client-rust`, or when `core/src` or `app/src` holds database code; then extend `scripts/check-boundary.mjs` (Principle I, R11)
- [ ] T017 [P] `admin-rust-app/Dockerfile` and `admin-rust-app/nginx.conf` per R11: build stage `rust:<pinned>` plus `wasm32-unknown-unknown` and pinned prebuilt `trunk`; `ARG`→`ENV` for `QP_API_BASE_URL`, `QP_OIDC_AUTHORITY`, `QP_OIDC_CLIENT_ID`; dependency layer built from `Cargo.toml`/`Cargo.lock` with stub sources; copies `contracts/openapi.yaml`; `trunk build --release`; serve stage `nginx` with `location = /health`, SPA fallback, `Cache-Control: no-store` on `index.html`, listen 5176 (copy `admin-app/nginx.conf`'s pattern)
- [ ] T018 Add service `admin-rust-app` to `docker-compose.yml` exactly as contract sign-in-realm.md's Compose table: build args, `5176:5176`, `depends_on` `backend: service_healthy` and `seed: service_completed_successfully`, health check `wget -qO- http://127.0.0.1:5176/health`; no service depends on it (FR-019). Add `ADMIN_RUST_OIDC_AUTHORITY=http://localhost:8080/realms/queuepass-admin-rust-app` to `.env.example`
- [ ] T019 [P] `scripts/run-host.mjs`: start `trunk serve --port 5176` in `admin-rust-app/` with the three `QP_*` variables; add 5176 to `E2E_PORTS` in `scripts/e2e.mjs`; extend `scripts/test/run-host.test.mjs` and `scripts/test/e2e-ports.test.mjs` first
- [ ] T020 [P] *(test first)* `scripts/test/coverage-report.test.mjs`: `WORKSPACES` includes `admin-rust-app` and `--clean` removes its `coverage/`; then add it to `scripts/coverage-report.mjs`. Write `admin-rust-app/scripts/coverage-summary.mjs`, converting `coverage/llvm-cov.json` (`data[0].totals.lines.{count,covered,percent}`) into `coverage/coverage-summary.json` as `total.lines.{total,covered,pct}`. Add `@queuepass/admin-rust-app` to the root `test` script after `@queuepass/admin-app` (R9, R12)

### `core` foundations

- [ ] T021 **Spike first**: `admin-rust-app/core/build.rs` loads `contracts/openapi.yaml`, adds every `components.schemas` entry to a `typify::TypeSpace` by name so the 267 `$ref: '#/components/schemas/X'` resolve (`add_ref_types`, as `progenitor` does), and writes the types to `OUT_DIR`, included as `core::api::types`. Any schema that fails is listed in the impl PR and hand-written in `core/src/api/types_manual.rs` (R5)
- [ ] T022 *(test first)* [P] `core/tests/contract_types.rs`: each hand-written type serializes to a fixture that validates with `jsonschema` against `components.schemas.<Name>`; for generated types, one example per resource deserializes
- [ ] T023 *(test first)* `core/tests/api_client.rs` (`wiremock`): every call sends `Authorization: Bearer <token>`; a `4xx`/`5xx` with the contract error shape becomes `ApiError { status, code, message, details }`; a network failure becomes `Unreachable`; a non-JSON error body becomes a generic `ApiError`
- [ ] T024 `core/src/api/client.rs`: `ApiClient { base_url, token source }` over `reqwest`, `ApiError`, and one function per operation `admin-app/src/api/*.ts` calls (events, images, locations, orders, reports, seating, tiers, hello), with the same paths, methods, and bodies
- [ ] T025 *(test first)* [P] `core/tests/auth_state.rs`: the `AuthState` transitions of data-model.md (sign-in with role → `SignedIn`; no `queuepass-admin` → `WrongRole`; renewal before expiry; refresh failure → `RenewFailed`, retried every 30 s and on `online`, → `SignedIn`; refresh refused → `SigningIn`; log out from any signed state; Backend unreachable → `Unreachable`); `returnTo` kept across sign-in; an in-memory `PkceStore` is empty after the code exchange. Mirror the auth-provider cases in `packages/shared/test/`
- [ ] T026 `core/src/auth/`: `AuthState` machine, `PkceStore` trait, token expiry and renewal schedule from an injected clock (no `std::time::SystemTime`), role check from the access token's realm roles, no I/O
- [ ] T027 *(test first)* [P] `core/tests/time.rs`: port the cases of `admin-app/test/event-form-times.test.ts`, `format.test.ts`, `event-default-times.test.tsx`, `event-form.tz.test.tsx`, and the `packages/shared/test/` cases for `time-zone.ts` and the doors-open helpers in `event.ts`: venue-zone local ↔ instant, skipped local time refused with the React message, repeated time chosen by offset, display with the zone made clear, "next whole hour" and "+4 hours" defaults (036 FR-017), 15-minute doors steps 0–6 h
- [ ] T028 `core/src/time.rs` and `core/src/format.rs` (`chrono`, `chrono-tz`) passing T027 (R6)
- [ ] T029 *(test first)* [P] `core/tests/money.rs`: port the money cases of `admin-app/test/format.test.ts` and `fixtures-005.ts` for `money.ts`, and `BASE_PRICE_PATTERN` from `packages/shared/src/event.ts` (parsing, exact cents, USD formatting); then `core/src/money.rs` (no floating point)
- [ ] T030 *(test first)* [P] `core/tests/theme.rs`: parse `admin-rust-app/style/theme.css` and check every text-on-surface and control pair for AA contrast (4.5:1 text, 3:1 controls and focus) in light and dark; then `core/src/theme.rs` (the parser and contrast math) (R8, R9)

### App shell (User Story 1's frame, used by every story)

- [ ] T031 `app/src/config.rs`: `QP_API_BASE_URL`, `QP_OIDC_AUTHORITY`, `QP_OIDC_CLIENT_ID` via `env!` (R11). `app/src/oidc_glue.rs`, **proved end to end before any screen work**: `openidconnect` discovery with `ProviderMetadataWithLogout`, authorization-code request with PKCE `S256` (verifier and `state` in `sessionStorage` through a `PkceStore` impl, removed at once after the exchange), code exchange, ID-token validation (confirm Keycloak's `/certs` sends CORS headers to 5176, or record the R3 fallback), refresh grant, `returnTo`, back-forward-cache re-check, RP-initiated logout via `end_session_endpoint`; time from `js_sys::Date::now()`; driving `core::auth` (R3)
- [ ] T032 `app/src/shell.rs`, `app/src/main.rs`, `app/src/routes.rs`: the red header (brand "QueuePass Admin (Rust)" linking to Venues; nav Venues, Events, Reports; "Log out" button; no username, as `admin-app/src/App.tsx`), the wrong-role page, the unreachable page, the `/` home page showing `/hello/admin`, error banner with the distinct scheduling-conflict look, one-time notices cleared from history (parity S1–S10), and every route of `admin-app/src/App.tsx`

**Checkpoint**: `docker compose up --build` brings up `admin-rust-app`. In the Rust Admin app you can sign in, see the home page, and log out.

---

## Phase 3: User Story 1 — Sign in next to the React app (P1) 🎯 MVP

**Goal**: both Admin apps signed in at once; Rust is red and named; logging out of one leaves the other.
**Independent test**: quickstart S1.

- [ ] T033 *(test first)* [US1] `e2e/fixtures/apps.ts`: add key `'admin-rust'`: `{ url: 'http://localhost:5176', name: 'QueuePass Admin (Rust)', role: 'admin' }`; add the entry to every `Record<AppName, …>` (`e2e/tests/001-sign-in.spec.ts`, `027-sign-in-background.spec.ts`, `028-app-realms.spec.ts`) so `tsc -p e2e` passes; add an `adminApp` fixture (default `APPS.admin`, `APPS['admin-rust']` in project `admin-rust`) and the `admin-rust` project with `grep: /@admin/` to `e2e/playwright.config.ts` (R10)
- [ ] T034 *(test first)* [US1] `e2e/tests/037-rust-admin-app.spec.ts`: test `037 S1: both Admin apps stay signed in, and logging out of one leaves the other`: sign in to both in one context; the sign-in heading reads "Sign in to QueuePass Admin (Rust)"; header and tab title contain "(Rust)"; the header and page background computed colors are the red tokens; after sign-in no PKCE value is left in `sessionStorage` and nothing in `localStorage`; opening `/events` signed out lands on Events after sign-in (`returnTo`); log out of Rust then React is still signed in after reload, and the reverse
- [ ] T035 [US1] `e2e/tests/028-app-realms.spec.ts`: add the Rust Admin app as a fourth app in the one-window test; update its title and, in the same commit, the matching Automated row in `specs/028-app-realms/quickstart.md`
- [ ] T036 [US1] Make T034 and T035 pass (fix shell, glue, seed, or theme as needed)
- [ ] T037 [US1] Tag the Admin journeys with Playwright's details object, `test('…', { tag: '@admin' }, …)`, never inside the title, and switch them from `APPS.admin` to `adminApp`: `001`, `002`, `003`, `020`, `024`, `025`, `030`, `031`, `035`, `036`, and the Admin steps of `015` (`016` has no Admin screen). Leave untagged, with a comment, any step that checks the React app's own code. Existing titles stay unchanged

**Checkpoint**: User Story 1 shippable. Commit, and keep going.

---

## Phase 4: User Story 2 — Venues and their seating (P1)

**Goal**: parity items V1–V7. **Independent test**: quickstart S2.

- [ ] T038 *(test first)* [P] [US2] `core/tests/venue_form.rs`: port the cases of `admin-app/test/section-lines.test.tsx`, `layout.test.tsx`, the venue-form checks, and the `packages/shared/test/` cases for `location.ts` (`US_STATES`, `ZIP_PATTERN`) and `time-zone.ts`' zone list
- [ ] T039 [P] [US2] `core/src/forms/venue.rs` and `core/src/forms/section_lines.rs` passing T038
- [ ] T040 [US2] `app/src/pages/venue_list.rs`: table (Name, Address, Seating capacity, Time zone), search "Name or address, such as a city", empty state "No venues yet", load error "Could not load venues" (V1)
- [ ] T041 [US2] `app/src/pages/venue_form.rs` and `app/src/components/section_lines.rs`: create and edit, all fields of V2, one-step save with verified or not-verified outcome (V3), Backend refusals beside their field with values kept (V4)
- [ ] T042 [US2] `app/src/pages/venue_detail.rs`: V5 (address with Google Maps link as `packages/shared/src/web/address-link.tsx`, "Not verified" note, time zone, capacity, Events here with past hidden and toggle, "Nothing is scheduled here.") and V7 (delete with confirmation, "Could not delete", "This venue no longer exists.", then the `Deleted "…"` notice)
- [ ] T043 [US2] `app/src/components/layout_card.rs`: change the layout (Section, Size, Seats), "Could not change the layout" with the reason (V6)
- [ ] T044 [US2] `e2e/tests/037-rust-admin-app.spec.ts`: test `037 S2: a venue and its layout made in the Rust Admin app show in the React Admin app` (create, then change the layout on the venue page); make `024` pass in project `admin-rust`

---

## Phase 5: User Story 3 — Schedule and edit events (P1)

**Goal**: parity items E2–E8. **Independent test**: quickstart S3.

- [ ] T045 *(test first)* [P] [US3] `core/tests/event_form.rs`: port every case of `admin-app/test/event-form-checks.test.ts`, `event-form-flow.test.tsx`, `event-doors-open.test.tsx`, `capacity.test.tsx`, and `event-types-edit.test.tsx`: each field check and message, when it shows (on leaving then as typed), first field at fault, seat totals per type and overall against the layout or total tickets, doors modes and switching keeps the instant, locked controls when tickets are sold
- [ ] T046 [US3] `core/src/forms/event.rs`: `EventFormState` of data-model.md ("each field's local value (`YYYY-MM-DDTHH:mm` per time field, as in 036), doors mode, ticket types, section-to-type map, limit, pending images, touched fields") and the checks and totals, passing T045
- [ ] T047 *(test first)* [P] [US3] `core/tests/images.rs`: port the `packages/shared/test/` cases for `event-image.ts` (`readImageHeader` type sniffing, size limit, pixel limits) and `admin-app/test/images-field.test.tsx`'s per-file notes; then `core/src/forms/images.rs` (parity E4b)
- [ ] T048 [US3] `core/src/api/events.rs` request builders: one all-or-nothing create (event, ticket types, seating; `031`) and the existing update request (`035`); map `ApiError.details` to the form field it names; tests in `core/tests/api_client.rs`
- [ ] T049 [US3] `app/src/pages/event_form.rs` section Venue and times (E2): venue select, name, Starts and Ends as date and time controls in the venue zone, doors open in two modes, defaults for a new event
- [ ] T050 [US3] Section Tickets and seating (E3): total tickets or reserved seating, ticket types add and remove, section → type or Not for sale, live totals announced politely
- [ ] T051 [US3] Section Details (E4, E4b): tickets per customer (No limit or a number); `app/src/components/images_field.rs` (Add images, up to 5, move earlier and later, remove, per-file checks and notes)
- [ ] T052 [US3] Submit and refusals (E5–E7): never send a known problem, focus the first field at fault, save all or nothing, then upload pictures in order with a per-picture failure message; a Backend refusal beside its field and focused, values kept; a scheduling conflict shown in its distinct look
- [ ] T053 [US3] Edit mode (E8): load the event, lock controls with the reason when tickets are sold, save through the update request
- [ ] T054 [US3] `e2e/tests/037-rust-admin-app.spec.ts`: test `037 S3: an event scheduled in the Rust Admin app with ticket types, seating, a limit, and pictures reads the same in the React Admin app`; make `003`, `020`, `025`, `031`, `035`, `036` pass in project `admin-rust`

---

## Phase 6: User Story 4 — Events, sales, and seats (P2)

**Goal**: parity items E1, E9–E14. **Independent test**: quickstart S4.

- [ ] T055 *(test first)* [P] [US4] `core/tests/seat_stream.rs`: parse the seat stream's framing as `packages/shared/src/web/seat-stream.ts` does (snapshot, then changes), map to `SeatState` (`Open`, `Held`, `Sold`), and signal reconnect when the server ends the stream; then `core/src/api/seat_stream.rs`
- [ ] T056 [US4] `app/src/pages/event_list.rs`: E1 (columns; name, venue, and From–To filters with "From must be on or before To."; Show past events with Ended; Cancelled; the three empty states; "Could not load events")
- [ ] T057 [US4] `app/src/pages/event_detail.rs`: E9 (details, status, the image gallery rotating every `GALLERY_INTERVAL_MS` with its pause control and the full-size viewer, as `image-gallery.tsx`, `image-viewer.tsx`, and `use-gallery-rotation.ts`) and E14 (cancel and delete with confirmation, "Could not cancel", "Could not delete", "This event no longer exists.")
- [ ] T058 [P] [US4] `app/src/components/tiers.rs` (E10) and `app/src/components/sales_card.rs` (E11)
- [ ] T059 [US4] `app/src/components/seating_card.rs` (E12), and `app/src/components/seat_grid.rs` with `app/src/seat_stream.rs` (E13: streaming `fetch` with the `Authorization` header, live updates, reconnect at token expiry, "Row r, Seat s" names with sold, held, and open told apart without color)
- [ ] T060 [US4] `e2e/tests/037-rust-admin-app.spec.ts`: test `037 S4: the Rust Admin app's event page shows live seats and edits tiers and seating` (a seat held and then sold from the Customer app appears without a reload; the Sales card shows it; a tier price edit and a section set Not for sale show in the React Admin app); make `002`, `015` (Admin steps), and `030` pass in project `admin-rust`

---

## Phase 7: User Story 5 — Attendees, reports, downloads (P2)

**Goal**: parity items A1–A2, R1–R3, X1–X5. **Independent test**: quickstart S5.

- [ ] T061 *(test first)* [P] [US5] `core/tests/export_rows.rs`: port the cases in `admin-app/test/export/` (`attendee-rows`, `sales-rows`, `file-name`, `csv`, `xlsx`, `pdf`, `pdf.fit`), `attendees-export.test.tsx`, and `reports-export.test.tsx`. Add input fixtures `core/tests/fixtures/export/*.json` and the React app's output for them (rows and the CSV text) in `core/tests/fixtures/export/expected/`, made once by a new script `scripts/export-parity-fixtures.mjs` that imports `admin-app/src/export/*.ts` without changing it; the Rust output must equal it (SC-004)
- [ ] T062 [US5] `core/src/export/{rows,table,made,file_name}.rs` passing T061; "Made by <username>", the time-zone note, the Attendees privacy note; the made-at time and file name in a zone passed in by the caller (X4)
- [ ] T063 *(test first)* [P] [US5] `core/tests/export_files.rs`: CSV equals the React CSV for each fixture byte for byte, apart from the `Exported at` column's values (BOM, CRLF, formula prefix: X1); XLSX read back with `calamine` (dev-dependency) has the same cells and typed numbers, dates, and money (X2); PDF text extracted with `lopdf` (dev-dependency) has the title, notes, header on every page, and every row, with a missing character as `?` and `REPLACED_NOTE` (X3); all three formats at 5,000 and 25,000 tickets (X5, as `admin-app/test/export/size.test.ts`)
- [ ] T064 [US5] `core/src/export/{csv,xlsx,pdf}.rs` (`csv`, `rust_xlsxwriter` `wasm` feature, `printpdf` with embedded Noto Sans and a repeated-header table layout with `nowrap` columns) passing T063 (R7)
- [ ] T065 [US5] `app/src/device_zone.rs` (the admin's zone via `js_sys::Intl::DateTimeFormat`, R6), `app/src/download.rs` (Blob plus temporary `download` link, as `admin-app/src/export/save.ts`), and `app/src/components/export_menu.rs` (CSV, XLSX, PDF; group label as the React `ExportMenu`)
- [ ] T066 [US5] `app/src/pages/attendees.rs` (A1, A2: "Attendees: <event>", columns, "Check-in details removed on …", Download the attendee list)
- [ ] T067 [US5] `app/src/pages/reports.rs` (R1, R2: Revenue, Tickets sold with meter, Checked in with meter, Scheduled events, By event table with % sold, Download the sales report)
- [ ] T068 [US5] `e2e/tests/037-rust-admin-app.spec.ts`: test `037 S5: attendees, reports, and every download in the Rust Admin app` (table contents and report figures match the React Admin app's for the same event; each of the six downloads produces a file with the expected name; the 5,000-ticket PDF downloads in the Rust app)

---

## Phase 8: Polish and cross-cutting

- [ ] T069 `.github/workflows/ci.yml`: in the `test` job, add a named step `npm run rust:setup` in the same place as in the root `ci` script, so `scripts/test/ci-workflow.test.mjs` still passes; add no other step and no cache. The `e2e` job's stack builds `admin-rust-app`, and both Playwright projects run. Record each job's time on the impl PR; if either is over 25 of its 30 minutes, say so and propose the 011 amendment of R12 instead of working around it
- [ ] T070 [P] `README.md`: Rust Admin app URL `http://localhost:5176`, the same admin accounts in its own realm, `rustup` plus `npm run rust:setup` for host builds and tests, and that the first Docker build takes minutes
- [ ] T071 `npm run ci` green: format, lint (both clippy runs), build, `npm test` (`admin-rust-app` ≥ 80% lines on `core`, in the coverage report), `npm run coverage:report`; and `npm run e2e` green
- [ ] T072 Parity walk: go through `contracts/parity-checklist.md` and tick every item E, U, or M in the impl PR description; fix the checklist where the React app differs
- [ ] T073 Running-system gate from a fresh clone: `docker compose up --build`, seed succeeds the first time, sign in, use, and log out of all four front ends; run `037 S1` with `--repeat-each=10` (SC-007); record the date
- [ ] T074 Hallway test (quickstart S9, SC-003): 5 people, both apps, record the result in the impl PR
- [ ] T075 Update `quickstart.md`'s Automation rows S1–S5 to Automated with their exact test titles; `node scripts/check-quickstart-marks.mjs` passes
- [ ] T076 Independent review by a Claude session that did not write the implementation; fix findings; record the review in the impl PR description; open the PR only after the spec PR is merged, with `fixes #163` in its description

---

## Dependencies

- Phase 1 → Phase 2 → every story. Within Phase 2, T021 (typify spike) and T031 (sign-in proved
  end to end) come first: they carry the most technical risk.
- US1 (Phase 3) is the MVP and needs only Phase 2. T037 (tagging the journeys) comes before the
  "pass in `admin-rust`" parts of T044, T054, and T060.
- US2 → US3 (the event form needs venues with layouts to pick). US4 and US5 need events, so they
  come after US3, but they are independent of each other.
- Phase 8 after all stories.

## Parallel examples

- Phase 1: T004–T007 together.
- Phase 2: T008, T009, T010, T014, T015, T016, T017, T019, T020 together (different files); then
  T022–T030 in `core`, each test task in parallel with other areas' tests.
- US2: T038 and T039 (`core`) in parallel with T040 (list page).
- US3: T045 and T047 (tests) together.
- US4 and US5 can run side by side once US3 is done: T055–T060 and T061–T068.
- Within US5: T061 and T063 (tests) in parallel; T062 and T064 after.

## Implementation strategy

1. **MVP**: Phases 1–3. The Rust Admin app is up, red, signed in beside the React app, and logged
   out independently. It is a constitution "stub front end" and safe to demo.
2. Add venues (US2), then events (US3): the app is now usable for real admin work.
3. Add the read-only pages and the live seat map (US4), then attendees, reports, and downloads
   (US5): full parity.
4. Polish: CI, README, parity walk, fresh-clone gate, hallway test, review, PR.
