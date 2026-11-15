# Tasks: Rust Customer App

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R14),
[data-model.md](./data-model.md), [contracts/sign-in-client.md](./contracts/sign-in-client.md),
[contracts/parity-checklist.md](./contracts/parity-checklist.md) (shell S1–S16, events B1–B8, venues
V1–V3, event page E1–E8, general admission P1–P11, seat map and holds M1–M16, cart C1–C10, My
tickets T1–T12, formats F1–F6, same layout SL1–SL12), [quickstart.md](./quickstart.md) (S0–S11).
OpenAPI contract unchanged. 67 tasks.

**Issue**: [#175](https://github.com/Trughouse-Holdings/QueuePass/issues/175). The implementation
PR's **description** says `fixes #175`. No commit message on either branch, and not the spec PR,
may contain "fixes #175", "closes #175", or "resolves #175". Cite it as plain `#175`.

**Tests**: **REQUIRED and written first** (Constitution VI). Write each task marked *(test first)*
and see it **fail** before the task it covers. For a `core` port, the React Customer app's own tests
(`customer-app/test/`) and the shared package's tests (`packages/shared/test/`) are the reference
cases: port each case that checks logic, then the code. For copied Rust Admin modules, their tests
come with them and must pass before any change.

## Ground rules

- **Commits**: `Impl 040: <what> (T0xx–T0yy, #175)`; the body names the FR, R, or parity row.
- **Reference**: the React Customer app (`customer-app/src`), the shared web code it uses
  (`packages/shared/src/web/`), and the merged specs are the source of truth for behavior, words,
  and layout. Use the same element structure, `class` values, and accessible names, so the shared
  stylesheets apply (R6) and the browser tests drive both apps (R13). Where the parity checklist
  and the React app disagree, follow the React app and fix the checklist in the impl PR. Copy the
  quirks the checklist names.
- **Do not change** `customer-app/`, `admin-rust-app/` (copy from it, link its `style/red.css`;
  R4, R6), any Backend rule or endpoint, or the OpenAPI contract. A copied file starts with
  `// Copied from admin-rust-app/<path> at 680b4f7 (spec 040 R4).`
- **Toolchain**: `rustup`, then `npm run rust:setup` (works on Windows after T006).
- **Two pull requests** (Constitution III): this spec PR (with constitution 3.12.0) and
  `040-rust-customer-app-impl`, cut from this spec branch while it is open and rebased on `main`
  once it merges, written in a fresh session from the spec and plan only. One independent review of
  each branch.
- **No merge, no push to `main`.** Shared-surface files need every team member's approval.
- **Parallel sessions**: see "Parallel sessions" at the end. Each session works on its own branch
  off `040-rust-customer-app-impl` and merges back into it; tasks marked [P] touch different files.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

- [ ] T001 Cut `040-rust-customer-app-impl`; `npm ci`; `npm test` on the untouched tree so later failures are this feature's; note `main`'s commit, and list in the impl PR any Customer app change merged after `680b4f7` (FR-012); confirm constitution 3.12.0 is in the tree (a gap in it goes back to the spec PR, not into code)
- [ ] T002 Create `customer-rust-app/` per plan: `Cargo.toml` (workspace members `core`, `app`, the Rust Admin app's workspace settings and release profile), `Cargo.lock` copied from `admin-rust-app/Cargo.lock` (R1), `rust-toolchain.toml` (copied: `1.100.0`), `.cargo/config.toml` (copied), `.gitignore` (`target/`, `dist/`, `coverage/`)
- [ ] T003 Create crates `customer-rust-app/core` (`customer-rust-core`, lib `customer_rust_core`) and `customer-rust-app/app` (`customer-rust-app`, bin, depends on `core`) with plan Technical Context's dependencies (no `printpdf`, `rust_xlsxwriter`, `csv`; add `hmac`, `sha2`, `qrcode`, `gloo-timers`); `cargo build` and `cargo build --target wasm32-unknown-unknown -p customer-rust-app` succeed
- [ ] T004 [P] `customer-rust-app/package.json` (`@queuepass/customer-rust-app`, private, no dependencies): `dev` (`trunk serve --port 5177`), `build` (`trunk build --release`), `test` (`cargo llvm-cov --package customer-rust-core --fail-under-lines 80 …` then `node scripts/coverage-summary.mjs`, as `admin-rust-app`), `lint` (both clippy commands), `format:check` (`cargo fmt --check`), and the `coverage` note naming the `app` exclusion and its replacement control (R11); add the workspace to root `package.json` `workspaces`, and `npm run test --workspace @queuepass/customer-rust-app` to the root `test` script after `@queuepass/customer-app`
- [ ] T005 [P] `customer-rust-app/index.html` (`<html lang="en">`, charset, viewport `width=device-width, initial-scale=1.0`, `<title>QueuePass Tickets (Rust)</title>`, Trunk links in this order: `../packages/shared/src/web/theme.css`, `../customer-app/src/styles.css`, `../admin-rust-app/style/red.css`, then the app crate) and `Trunk.toml` (port 5177) (R6, parity S10)
- [ ] T006 [P] *(test first)* `scripts/test/rust-setup.test.mjs`: `hostTriple('win32','x64')` is `x86_64-pc-windows-msvc` (and `arm64`); `assetUrl` gives `trunk-x86_64-pc-windows-msvc.zip` and `cargo-llvm-cov-x86_64-pc-windows-msvc.zip` at the pinned versions, `.tar.gz` elsewhere unchanged; the installed name is `<tool>.exe` on Windows; `version()` runs `cargo.exe`/`trunk.exe`; `rustup show` runs in both `admin-rust-app/` and `customer-rust-app/`. Then `scripts/rust-setup.mjs`: the Windows triples; zip assets downloaded to a temporary file and the one `.exe` extracted with `tar -xf`; both `rustup show` runs (R14). Run `npm run rust:setup` on Windows: with the pinned tools present it installs nothing

---

## Phase 2: Foundational (blocks every story)

### Client, seed, Backend trust (contract sign-in-client.md)

- [ ] T007 *(test first)* [P] `packages/shared/test/realms.test.ts`: `APP_REALMS` unchanged (4 rows, 240 accounts); `SHARED_REALM_CLIENTS` equals `[{ app: 'customer-rust', realm: 'queuepass-customer-app', clientId: 'customer-rust-app' }]`; each row's realm is an `APP_REALMS` realm; client IDs unique across both tables; `realmOfApp` finds both kinds; the seed and e2e copies equal both tables
- [ ] T008 *(test first)* [P] Backend: give `backend/test/setup/tokens.ts` an `azp` option; in `backend/test/integration/auth.realms.e2e-spec.ts` (or a new `auth.shared-client.e2e-spec.ts`) the cases of contract sign-in-client.md: `azp: customer-rust-app` gets `200` on `GET /me/orders`; an order placed with `azp: customer-app` is listed with `azp: customer-rust-app` for the same `sub`, and a reservation made with one is released with the other; no `customer` role → `403`; wrong audience, expired, another realm's key → `401`. `backend/test/integration/cors-docs.e2e-spec.ts`: preflight from `http://localhost:5177` allowed
- [ ] T009 *(test first)* [P] Seed tests: `scripts/seed/test/clients.unit.test.ts` (`PORTS` gains 5177; the client loop covers `SHARED_REALM_CLIENTS`), `provision-clients.test.ts` (`customer-rust-app`: public, PKCE `S256` only, no direct grants, exact `http://localhost:5177/` redirect and post-logout URIs, web origin, default scopes `roles` and `queuepass-api`, name `QueuePass Tickets (Rust)`), `seed-idempotence.test.ts` (the client is made in `queuepass-customer-app`; no user is created for it; a rerun converges; 240 accounts), `rename.test.ts` (after a pre-028 rename the client stays enabled; `OTHER_CLIENTS` does not list it)
- [ ] T010 Add `SHARED_REALM_CLIENTS`, `SharedRealmClientRow`, and `realmOfApp` to `packages/shared/src/realms.ts` (R3) and export them; the import-free copies in `scripts/seed/src/app-realms.ts` and `e2e/fixtures/realms.ts`; T007 passes
- [ ] T011 Seed: `{ clientId: 'customer-rust-app', name: 'QueuePass Tickets (Rust)', port: 5177 }` in `FRONTEND_CLIENTS`; in `scripts/seed/src/index.ts`, after the realm loop, `provisionClient` for each `SHARED_REALM_CLIENTS` row in its realm; update the header comment and the done line (clients count); leave `legacy-realm.ts` and `provision-users.ts` unchanged; T009 passes
- [ ] T012 Add `http://localhost:5177` to `CORS_ORIGINS` in `.env.example`, `docker-compose.yml`, `scripts/run-host.mjs`, `backend/test/setup/test-app.ts`, and `backend/test/integration/cors-docs.e2e-spec.ts`; T008 passes with no Backend source change
- [ ] T013 [P] *(test first)* Sign-in look (R7): `scripts/seed/test/login-theme-files.test.ts` (`.qp-app--customer-rust-app` maps to the `rust` set; `qpAudience.customer-rust-app`), `scripts/seed/test/sign-in-screens.test.ts` (the heading "Sign in to QueuePass Tickets (Rust)" and the audience line for the new client; `customer-app` unchanged), `packages/shared/test/theme/drift.test.ts` (the new selector allowed); then in `keycloak/themes/queuepass/login/resources/css/login.css` make the red rule `.qp-app--admin-rust-app, .qp-app--customer-rust-app`, and add `qpAudience.customer-rust-app=For customers buying and viewing tickets, Rust version` to `messages_en.properties`. No new token in `theme.css`

### Container, configuration, boundary, coverage

- [ ] T014 *(test first)* [P] `scripts/test/` boundary test: `scripts/check-boundary.mjs` scans both Rust apps' manifests (`Cargo.toml`, `core/Cargo.toml`, `app/Cargo.toml`) and sources (`core/src`, `app/src`) for the forbidden crates and text; then turn its `RUST_APP` constant into a list (R12)
- [ ] T015 [P] `customer-rust-app/Dockerfile` and `nginx.conf` from `admin-rust-app`'s (R12): `customer-rust-app` paths; `ARG`→`ENV` for `QP_API_BASE_URL`, `QP_OIDC_AUTHORITY` (default the Customer realm), `QP_OIDC_CLIENT_ID` (`customer-rust-app`); copies `contracts/openapi.yaml`, `packages/shared/src/web/theme.css`, `customer-app/src/styles.css`, `admin-rust-app/style/red.css`; no fonts; nginx as `customer-app/nginx.conf` on 5177 (parity S4, S14)
- [ ] T016 Add service `customer-rust-app` to `docker-compose.yml` exactly as contract sign-in-client.md's Compose table (FR-019: nothing depends on it)
- [ ] T017 [P] *(test first)* `scripts/test/run-host.test.mjs` and `scripts/test/e2e-ports.test.mjs`; then `scripts/run-host.mjs` (the sixth child and banner, contract Host run) and 5177 in `E2E_PORTS` of `scripts/e2e.mjs`
- [ ] T018 [P] *(test first)* `scripts/test/coverage-report.test.mjs`: `WORKSPACES` has `customer-rust-app` and `--clean` removes its `coverage/`; then `scripts/coverage-report.mjs`; copy `admin-rust-app/scripts/coverage-summary.mjs` into `customer-rust-app/scripts/`

### `core` foundations (copied, R4)

- [ ] T019 Copy `core/build.rs` (typify over the contract, `core::api::types`) and any hand-written types with their `core/tests/contract_types.rs`; it builds every schema as in the Rust Admin app
- [ ] T020 [P] Copy `core/src/api/client.rs`'s transport and error types with `core/tests/api_client.rs`'s transport cases; *(test first)* add a `wiremock` case per Customer operation of R5 (path, method, query keys, body, `Authorization: Bearer`); then the operations, replacing the Admin list
- [ ] T021 [P] Copy `core/src/auth/` and `core/tests/auth_state.rs`; *(test first)* a `queuepass-admin`-only token is `WrongRole` and a `customer` token is `SignedIn`; set `REQUIRED_ROLE = "customer"`
- [ ] T022 [P] Copy `core/src/{time,format,money}.rs` (the parts the Customer app uses) with their tests; *(test first)* port `customer-app/test/format.test.ts`, `times.tz.test.tsx`, and `doors-open.test.tsx` (F1–F6, B7, E4) and the shared `time-zone.ts` cases (`formatEventTime`, `formatEventEnd`, `formatDoorsOpen`, `formatViewerTime`); then the Customer `format.rs` functions (`usd`, `totalUsd`, `sumUsd`, `eventPrice`, `count`, `seatLabel`, `seatWithPrice`, `when`, `doorsOpen`, `startedNotice`)
- [ ] T023 [P] Copy `core/src/theme.rs` and `core/tests/theme.rs`; *(test first)* point them at `customer-app/src/styles.css` and `../admin-rust-app/style/red.css`: exactly the 14 look tokens redefined, no data token, and AA for every pair the Customer screens use, light and dark (R6)
- [ ] T024 [P] Copy `core/src/seating/{map_geometry,map_state,pan_zoom,venue_map}.rs`, `core/src/api/seat_stream.rs`, and their tests and fixtures (`seating_geometry`, `venue_map`, `seat_stream`); all pass unchanged; check the `Price` mode, legend, and `open_prices` against parity M4–M8

### App shell (User Story 1's frame)

- [ ] T025 Copy `app/src/{config,oidc_glue,auth,util,download,device_zone}.rs`; build-time `QP_*` for the Customer realm and `customer-rust-app`; **prove sign-in end to end** against `docker compose` (code with PKCE, `returnTo`, renewal, `pageshow`, end-session with `id_token_hint`) before any screen work (R2, parity S1–S4)
- [ ] T026 `app/src/{main,routes,shell,release}.rs`: "Signing in…"; the header of parity S9 (plain-text brand "QueuePass Tickets (Rust)", nav Events, Venues, My tickets, Cart with prefix-matched `navlink--active` and `aria-current`, nothing active on `/`, Log out); every route of S11 with the NotFound section; the wrong-role card (S7); the unreachable banner (S8); Log out running release on logout first, at most 2 s, never fatal (S5, S6); 401 → sign in with `returnTo` (S3)

**Checkpoint**: `docker compose up --build` brings up `customer-rust-app`; you can sign in on a red page, see a red shell, and log out (a constitution "stub front end").

---

## Phase 3: User Story 1 — Sign in beside the React app (P1) 🎯 MVP

**Goal**: red sign-in, same customer, shared session as accepted. **Independent test**: quickstart S1, S2.

- [ ] T027 *(test first)* [US1] `e2e/fixtures/apps.ts`: `'customer-rust': { url: 'http://localhost:5177', name: 'QueuePass Tickets (Rust)', role: 'customer' }`; the entry in every `Record<AppName, …>` (`001-sign-in.spec.ts`, `027-sign-in-background.spec.ts`, `028-app-realms.spec.ts`); `028`'s `realmOf` uses `realmOfApp`; new `e2e/fixtures/customer-app.ts` (`customerApp`, default `'customer'`); project `customer-rust` with `use: { customerApp: 'customer-rust' }` and `grep: /@customer/` in `e2e/playwright.config.ts` (R13)
- [ ] T028 *(test first)* [US1] `e2e/tests/040-rust-customer-app.spec.ts`: `040 S1: the Rust Customer app's sign-in is red and names it, and the customer is the same as in the React Customer app` (fresh context: heading "Sign in to QueuePass Tickets (Rust)", the accent computed red; the React Customer sign-in still teal; header and tab title; page and header computed colors are `red.css`'s; nothing in `localStorage`, no PKCE value left in `sessionStorage`; My tickets lists an order placed through the React app for the same customer; `returnTo`)
- [ ] T029 *(test first)* [US1] `040 S2: the two Customer apps share one session, and logging out of one releases holds and leaves every other app signed in` (quickstart S2: one context; the second Customer app signs in without the form; a held seat is released by the Rust app's Log out; after the access token's lifetime or a forced renewal, the React Customer app asks for sign-in; both Admin apps and the Booth still signed in)
- [ ] T030 [P] [US1] `e2e/tests/027-sign-in-background.spec.ts`: the fifth app's `AUDIENCE` entry; its line colour equals the Rust Admin app's; five apps, four distinct colours. `001-sign-in.spec.ts`: the new app in its per-app checks
- [ ] T031 [US1] Make T028–T030 pass (fix shell, glue, seed, or theme)
- [ ] T032 [US1] Tag the Customer journeys `{ tag: '@customer' }` (details object, never in the title) and switch their Customer steps from `'customer'` to `customerApp`: the list in R13. A journey that also uses the Admin app keeps `@admin` and gets both tags. Titles unchanged. Leave `028`'s one-window test untagged, with a comment (R13)

**Checkpoint**: US1 shippable and demoable. Commit, and keep going.

---

## Phase 4: User Story 2 — Find events and venues (P1)

**Goal**: parity B1–B8, V1–V3, E1–E5, SL2–SL6. **Independent test**: quickstart S3.

- [ ] T033 *(test first)* [P] [US2] `core/tests/filters.rs`: port `customer-app/test/filters.test.tsx` and `browse.test.tsx`'s logic (URL read and write, invalid and reversed dates dropped, `q` trimmed, the request query with `locationId` only once venues load, hide cancelled in the app, the 300 ms typing replace vs push rule); then `core/src/filters.rs` (B3, B4)
- [ ] T034 *(test first)* [P] [US2] `core/tests/gallery.rs`: port the logic cases of `customer-app/test/event-images.test.tsx` and the shared gallery tests (5,000 ms turn, 400 ms slide, the pause reasons, the card and page size clamps, "i of n"); move or copy the pure rules from the copied `gallery.rs` into `core/src/gallery.rs` (B6, E3)
- [ ] T035 [US2] Copy `app/src/components/{gallery,address_link,link,banners}.rs`; `app/src/components/{event_card,event_filters}.rs` and `app/src/pages/event_list.rs` (B1–B8)
- [ ] T036 [P] [US2] `app/src/pages/{venue_list,venue_detail}.rs` (V1–V3)
- [ ] T037 [US2] `app/src/pages/event_detail.rs`: E1–E5 and E8's page part, the page gallery and full-screen viewer, "All events"; the Get tickets slot (filled in US4 and US3)
- [ ] T038 [US2] Make the `@customer` journeys of `020 S6`, `030 S1/S2`, and the event-page parts of `003` and `036` pass in project `customer-rust`

---

## Phase 5: User Story 4 — General-admission purchase (P1)

**Goal**: parity P1–P11, E6, E7. **Independent test**: quickstart S4.

- [ ] T039 *(test first)* [P] [US4] `core/tests/availability.rs`: port `purchase-unavailable.test.tsx`, `started-notice.test.tsx`, `ticket-limit.test.tsx`, and `doors-open.test.tsx`' panel cases (closed badge and text, started note and its short form, limit line and box, quantity bounds, "From", totals in cents)
- [ ] T040 *(test first)* [P] [US4] `core/tests/holder_name.rs`: port `holder-name-field.test.tsx` and `packages/shared/test/holder-name.test.ts` (NFC, code points, messages in order)
- [ ] T041 *(test first)* [P] [US4] `core/tests/buy.rs`: port `purchase.test.tsx` and `rate-limit.test.tsx` (request id kept or renewed, a second press sends nothing, Check again resends the same id, 401, refusal kept values, unknown outcome, 429 waits BUY and HOLD apart with their countdown and singular "1 second")
- [ ] T042 [US4] `core/src/{availability,holder_name,buy}.rs` passing T039–T041 (R10)
- [ ] T043 [US4] `app/src/components/{get_tickets,order_confirmation}.rs` general-admission part (P1–P11, E6, E7) with the hidden assertive region and focus return
- [ ] T044 [US4] Make `006 P1/P4`, `016 S2`, and `034 S1/S2` pass in project `customer-rust`

---

## Phase 6: User Story 3 — Seats, holds, and the cart (P1)

**Goal**: parity M1–M16, C1–C10. **Independent test**: quickstart S5.

- [ ] T045 *(test first)* [P] [US3] `core/tests/hold_queue.rs`: port `seat-hold-click.test.tsx`'s queue cases (order, one at a time, cancel queued, opposite of in-flight, drop on refusal, drop holds on 429, clear on 401)
- [ ] T046 *(test first)* [P] [US3] `core/tests/reservation.rs`: port `seat-holds.test.tsx`, `seats.test.tsx`, `venue-map-flow.test.tsx`, and `sections-list.test.tsx`' logic (`seatView`, deadline from 201 or a new `createdAt`, never restarted by more seats, 250 ms ticks, warning once, run out, the hold log's 5 lines and 10 s clear, every refusal text including `SEAT_COOLDOWN` in the viewer's zone, M15's return from the cart)
- [ ] T047 *(test first)* [P] [US3] `core/tests/cart.rs`: port `cart.test.tsx` (read schedule decisions, entries by event and `createdAt`, fixed deadlines, the warning rule on every tick, detail retries and "Details unavailable", Buy outcomes, run out, vanished entries and the one `/me/orders` read, gone set)
- [ ] T048 [US3] `core/src/{hold_queue,reservation,cart}.rs` passing T045–T047 (R10)
- [ ] T049 [US3] Copy `app/src/venue_map/{venue_map,section_view,legend,pan_zoom}.rs` and `app/src/seat_stream.rs`; the Sections list and its focus moves; the stream with `withMine` and the 200 ms reservation re-read (M4–M8, M14)
- [ ] T050 [US3] Seated part of `get_tickets.rs` and `app/src/components/hold_countdown.rs`: stat tiles, Choose seats, notes, the map layout, Your seats, Add to cart, the hold log, refusals (M1–M3, M9–M13, M15)
- [ ] T051 [US3] `app/src/pages/cart.rs`: C1–C10 with the 1,000 ms reads while visible, `visibilitychange` and `focus` reads, one at a time, and the Name on tickets field
- [ ] T052 [US3] Test `040 S5: seats held in the Rust Customer app show in the React Customer app's cart and are bought in the Rust one`; make `007 S3`, `015`'s Customer steps, `026 S2`, `033 S1/S2/S6`, `038 S10/S12/S13`, `038 S10/S15`, `038 S14`, `038 S16`, and the other `038`/`039` Customer steps pass in project `customer-rust`

---

## Phase 7: User Story 5 — My tickets, entry code, print, calendar (P2)

**Goal**: parity T1–T12. **Independent test**: quickstart S6.

- [ ] T053 *(test first)* [P] [US5] `core/tests/my_tickets.rs`: port `my-tickets.test.tsx`, `past-events.test.tsx`, and `check-ins-removed.test.tsx` (upcoming and Past by the load time, ticket state text, which links show, calendar eligibility); then `core/src/my_tickets.rs`
- [ ] T054 *(test first)* [P] [US5] `core/tests/calendar.rs`: port `calendar.test.ts` and `add-to-calendar.test.tsx`; add `scripts/customer-parity-fixtures.mjs`, which imports `customer-app/src/calendar.ts`, `filters.ts`, and `packages/shared/src/live-code.ts` unchanged and writes outputs for fixture inputs to `customer-rust-app/core/tests/fixtures/`; the ICS text (apart from `DTSTAMP`), file name, and Google URL must equal them; then `core/src/calendar.rs`
- [ ] T055 *(test first)* [P] [US5] `core/tests/live_code.rs`: port `packages/shared/test/live-code.test.ts` and `entry-code.test.tsx`' clock cases, plus T054's live-code fixtures; then `core/src/live_code.rs` (`hmac`, `sha2`, base32 without padding, the offset rule, R9)
- [ ] T056 *(test first)* [P] [US5] `core/tests/qr.rs`: fixtures of `qrcode-generator` 2.0.4's module grids (type 0, level M) for a printed ticket code and three live codes, written by the T054 script; then `core/src/qr.rs` (the `qrcode` crate at the same version and level, alphanumeric mode, the mask chosen by a port of `getLostPoint`) and the SVG path text of parity T12. If the grids can't be made equal in time, apply R9's fallback and record it
- [ ] T057 [US5] `app/src/pages/my_tickets.rs` and `app/src/components/add_to_calendar.rs` (T1–T7, the Blob download with the 60 s revoke)
- [ ] T058 [P] [US5] `app/src/components/ticket_qr.rs` and `app/src/pages/print_ticket.rs` (T8, T12, print rules S15)
- [ ] T059 [US5] `app/src/pages/entry_code.rs` (T9–T11: both reads, every state, key in memory only, 250 ms checks, "Changes in n s")
- [ ] T060 [US5] Test `040 S6: the entry code, the printed ticket, and the calendar file are the same in both Customer apps`; make `019 S2` pass in project `customer-rust`

---

## Phase 8: Polish and cross-cutting

- [ ] T061 Test `040 S11: every page has the same structure and arrangement in both Customer apps, at desktop and phone width` (`037` R15's method over every route of parity S11 with the same data, at 1280 and 375 px); fix any difference in the Rust views (SL1–SL12, FR-020)
- [ ] T062 `README.md`: the Rust Customer app's URL `http://localhost:5177`, the same customer accounts, the shared session and what signing out of either Customer app does, `rustup` plus `npm run rust:setup` (Windows included), the ports 5173–5177, and the `.env` CORS note for an older `.env` (FR-018)
- [ ] T063 CI: no workflow change is expected (`rust:setup` is already a step and a part of `ci`); confirm `scripts/test/ci-workflow.test.mjs` passes; the `e2e` job builds `customer-rust-app` and runs the `customer-rust` project. Record both jobs' times on the impl PR; over 25 of 30 minutes, say so and propose `037` R12's 011 amendment instead of working around it (R14)
- [ ] T064 `npm run ci` green (format, lint with both Rust apps' clippy, build, `npm test` with `customer-rust-app` ≥ 80% on `core`, coverage report) and `npm run e2e` green, on Windows and in CI; run `040 S2` with `--repeat-each=10` (SC-006)
- [ ] T065 Parity walk: tick every row of `contracts/parity-checklist.md` E, U, M, or N/A in the impl PR, adding rows for Customer changes merged after `680b4f7` (T001); fix the checklist where the React app differs. Running-system gate from a fresh clone: `docker compose up --build`, seed succeeds the first time, sign in, use, and log out of all five front ends. Hallway test (quickstart S10, SC-003)
- [ ] T066 Update `quickstart.md`'s Automation rows S1, S2, S5, S6, and S11 to Automated with their exact test titles; `node scripts/check-quickstart-marks.mjs` passes. Independent review by a Claude session that did not write the implementation; fix findings; record the review in the impl PR description; open the PR with `fixes #175` in its description
- [ ] T067 Open a follow-up issue (not in this feature): extract the modules copied from `admin-rust-app/` into one shared Rust crate used by both Rust apps, after EDIS (R4)

---

## Dependencies

- Phase 1 → Phase 2 → every story. In Phase 2, T025 (sign-in proved) comes before any screen; T019
  before T020; T010 before T011 and T027.
- US1 (Phase 3) needs only Phase 2. T027 and T032 come before every "pass in `customer-rust`" task
  (T038, T044, T052, T060).
- US2 (T035–T037) gives the event page that US4 and US3 fill. US4 and US3 are independent of each
  other after T037, apart from sharing `get_tickets.rs` (US4 writes its general part first, or the
  two sessions agree the file's split: `get_tickets/general.rs`, `get_tickets/seated.rs`).
- US5 needs only the shell (T026) and T022; it is independent of US2–US4.
- All `core` test-and-port pairs (T033/T034, T039–T042, T045–T048, T053–T056) need only T022 and
  T024 and can start as soon as Phase 2's `core` foundations are in.
- Phase 8 after all stories.

## Parallel sessions

Five days to EDIS. A suggested split for up to four implementer sessions, each on its own branch
off `040-rust-customer-app-impl`:

| Session | Tasks | Touches |
|---|---|---|
| A: shared surface and browser tests | T006–T018, T027, T030, T032, T062, T063 | `packages/shared`, `scripts/`, `backend/test`, `keycloak/`, `docker-compose.yml`, `e2e/`, README |
| B: skeleton, shell, lists, event page | T002–T005, T019–T026, T033–T038, T061 | `customer-rust-app/` core foundations, shell, US2 |
| C: buying and My tickets logic and screens | T039–T044, T053–T060 | `core/{availability,holder_name,buy,my_tickets,calendar,live_code,qr}`, US4 and US5 screens |
| D: seats, holds, cart | T045–T052 | `core/{hold_queue,reservation,cart}`, map views, seated panel, Cart |

A starts at once; B's T002–T005 and T019–T025 go first because C and D build on them (C and D can
write their `core` tests against the React tests meanwhile). The session that integrates runs
T028, T029, T031, T064–T067.

## Implementation strategy

1. **MVP**: Phases 1–3. The Rust Customer app is up, red, signed in with the same customers, and the
   shared session behaves as accepted. Demoable.
2. Lists and the event page (US2), then general admission (US4): the app sells tickets.
3. Seats, holds, and the cart (US3): the main way customers buy.
4. My tickets, entry code, print, and calendar (US5): full parity.
5. Polish: the same-layout check, README, CI times, parity walk, fresh-clone gate, hallway test,
   review, PR.
