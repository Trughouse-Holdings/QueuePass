# Tasks: Rust Admin App

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R15),
[data-model.md](./data-model.md), [contracts/sign-in-realm.md](./contracts/sign-in-realm.md),
[contracts/parity-checklist.md](./contracts/parity-checklist.md) (shell S1–S15, venues V1–V10,
events E1–E17, seat maps M1–M17, layout editor LE1–LE81, attendees and reports A1–A3, R1–R3,
exports X1–X5, same layout SL1–SL14), [quickstart.md](./quickstart.md) (S0–S11). OpenAPI contract
unchanged.

> **2026-11-14** (spec Clarifications): rewritten and renumbered before any task was done. The
> Rust Admin app is now exactly like the React Admin app on `main` at `ff993c4`: the seat-map
> screens (`038`), the layout editor (`039`, new User Story 6, Phase 8), and the same layout
> (FR-020: the React app's stylesheets with a red color-token set, research R8; the `037 SL` check,
> R15) are added. 82 tasks.

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
  (`packages/shared/src/web/`), and the merged specs are the source of truth for behavior,
  wording, and layout. Use the same element structure, `class` values, and accessible names
  (labels, headings, button text, for example "Log out") so the shared stylesheets apply (R8) and
  the browser tests drive both apps (R10). Where the parity checklist and the React app disagree,
  follow the React app and fix the checklist in the impl PR. Copy the React app's quirks named in
  the checklist; don't fix them here.
- **Do not change** `admin-app/` or any Backend rule or endpoint. No OpenAPI change.
- **Do not touch** Mahdi's branches, including his Customer app Rust work.
- **Toolchain**: `rustup`, then `npm run rust:setup` once T004 exists.
- **Two pull requests** (Constitution III): the spec PR (#164, merged, and this amendment's PR).
  Implementation is `037-rust-admin-app-impl`, cut from `main` after this amendment merges and
  written in a fresh session from the spec and plan only. One independent review of each branch
  before it is asked to merge.
- **No merge, no push to `main`.** Each PR asks for review. The shared-surface files need every
  team member's approval.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US6 from spec.md

---

## Phase 1: Setup

- [X] T001 Cut `037-rust-admin-app-impl` from `main` (an older local branch of that name, cut from the first spec tip, is replaced); `npm ci`; `npm test` on the untouched tree so later failures are this feature's; note `main`'s commit, and list in the impl PR any Admin change merged after `ff993c4` (FR-012)
- [X] T002 Create `admin-rust-app/` per plan: `Cargo.toml` (workspace members `core`, `app`), `rust-toolchain.toml` (current stable, `targets = ["wasm32-unknown-unknown"]`, `components = ["llvm-tools-preview", "rustfmt", "clippy"]`), edition 2024, `.gitignore` (`target/`, `dist/`, `coverage/`), `.cargo/config.toml` with the `getrandom` WebAssembly backend cfg if the pinned `getrandom` is 0.3 (R3); add `**/target/` to `.dockerignore`, `.prettierignore`, and the `ignores` of `eslint.config.mjs` (R11)
- [X] T003 Create crate `admin-rust-app/core` (`admin-rust-core`, lib) and crate `admin-rust-app/app` (bin, depends on `core`) with the dependencies of plan Technical Context; `reqwest` with default TLS off for wasm; `printpdf` pinned to one minor version
- [X] T004 *(test first)* [P] `scripts/test/rust-setup.test.mjs`: `scripts/rust-setup.mjs` runs `rustup show` in `admin-rust-app/`, and installs pinned prebuilt `trunk` and `cargo-llvm-cov` into `~/.cargo/bin` only when missing or at another version; then write `scripts/rust-setup.mjs` and root script `"rust:setup": "node scripts/rust-setup.mjs"`, and put `npm run rust:setup` in the root `ci` script right after `prisma:generate` (R12)
- [X] T005 [P] Create `admin-rust-app/package.json` (`@queuepass/admin-rust-app`, private, no dependencies) with scripts `build` (`trunk build --release`), `test` (`cargo llvm-cov --package admin-rust-core --fail-under-lines 80 --json --summary-only --output-path coverage/llvm-cov.json && node scripts/coverage-summary.mjs`), `lint` (both clippy commands of R9), `format:check` (`cargo fmt --check`), and a `coverage` note naming the `app` crate exclusion and its reason (Constitution VI); add `admin-rust-app` to root `package.json` `workspaces`
- [X] T006 [P] Create `admin-rust-app/index.html` (`<html lang="en">`, viewport meta, `<title>QueuePass Admin (Rust)</title>`, Trunk links for the app crate and, in this order, `../packages/shared/src/web/theme.css`, `../admin-app/src/styles.css`, and `style/red.css`, R8) and `admin-rust-app/Trunk.toml` (dev port 5176)
- [X] T007 [P] Create `admin-rust-app/style/red.css`: only custom properties, in `:root` and the `prefers-color-scheme: dark` block, redefining exactly the 14 look tokens of R8 (`--bg`, `--surface`, `--surface-alt`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--text-faint`, `--accent`, `--accent-hover`, `--accent-soft`, `--accent-text`, `--brand-mark-end`, `--brand-mark-text`: accent `#b3261e`, page `#fdecea`, red-tinted surfaces, which the header uses too, and a dark-red dark set) and no other token (data colors `--danger*`, `--warn*`, `--ok*`, `--level-*`, `--map-*`, `--seat-*` and every other token stay the shared theme's); no selector rule and no layout, size, spacing, or type rule (R8)

---

## Phase 2: Foundational (blocks every story)

### Realm, seed, Backend trust (contract sign-in-realm.md)

- [X] T008 *(test first)* [P] `packages/shared/test/realms.test.ts`: assert the new row `{ app: 'admin-rust', realm: 'queuepass-admin-rust-app', clientId: 'admin-rust-app', role: 'queuepass-admin', prefix: 'admin', count: 5 }`; change the realm count to 4, "roles equal `QUEUEPASS_ROLES`" to "every row's role is in `QUEUEPASS_ROLES`, and every role has a row", and the account total 235 to 240; realms and client IDs unique; the seed and e2e copies equal the table
- [X] T009 *(test first)* [P] `backend/test/integration/auth.realms.e2e-spec.ts`: confirm the `APP_REALMS`-driven cases now include the new realm and add any missing: valid admin token → `200` on an admin endpoint; no role → `403`; only `customer` or `gate-agent` → `403`; another realm's key claiming the new issuer → `401`; expired → `401`; wrong audience → `401`. `backend/test/integration/cors-docs.e2e-spec.ts`: preflight from `http://localhost:5176` allowed
- [X] T010 *(test first)* [P] Seed tests: `scripts/seed/test/clients.unit.test.ts` (`PORTS` gains 5176), `scripts/seed/test/provision-clients.test.ts` (the `admin-rust-app` client is public, PKCE `S256` only, direct-access grants off, exact redirect URI and web origin for 5176, `queuepass-api-audience` mapper, name `QueuePass Admin (Rust)`), provisioning tests for realm login theme `queuepass` and users `admin1`–`admin5` with `queuepass-admin`, and a rerun converging with no duplicate
- [X] T011 Add the `admin-rust` row to `APP_REALMS` and widen `AppRealmRow['app']` in `packages/shared/src/realms.ts`; update the import-free copies in `scripts/seed/src/app-realms.ts` and `e2e/fixtures/realms.ts`; update `EXPECTED_COUNTS` and the 235 comments in `scripts/seed/src/provision-users.ts`; grep every other use of `APP_REALMS` and `Role` for a one-realm-per-role assumption and fix it (leave `backend/src/hello/hello.controller.ts` as it is, R11)
- [X] T012 Add `{ clientId: 'admin-rust-app', name: 'QueuePass Admin (Rust)', port: 5176 }` to `scripts/seed/src/provision-clients.ts` (R11)
- [X] T013 Add `http://localhost:5176` to `CORS_ORIGINS` in `.env.example`, `docker-compose.yml` (wherever set), `scripts/run-host.mjs`, `backend/test/setup/test-app.ts`, and `backend/test/integration/cors-docs.e2e-spec.ts`; confirm T009 now passes
- [X] T014 [P] *(test first)* Red sign-in accent set: extend `packages/shared/test/theme/contrast.test.ts`, `tokens.test.ts`, and `drift.test.ts` for a fourth app, then add the full seven-role set (accent, hover, soft, text, brand-mark-end, brand-mark-text, stone-accent; light and dark) to the sign-in token block of `packages/shared/src/web/theme.css`, so `check-theme.ts` passes (Constitution VII, R8, R11)
- [X] T015 [P] Keycloak theme: map body class `qp-app--admin-rust-app` to the red set in `keycloak/themes/queuepass/login/resources/css/login.css`; add `qpAudience.admin-rust-app=For QueuePass staff, Rust version` to `keycloak/themes/queuepass/login/messages/messages_en.properties`; extend `scripts/seed/test/login-theme-files.test.ts` and `scripts/seed/test/sign-in-screens.test.ts`; in `e2e/tests/027-sign-in-background.spec.ts`, expect four line colours and add the fourth `AUDIENCE` entry

### Container, configuration, boundary, coverage

- [ ] T016 *(test first)* [P] `scripts/test/` boundary test: `scripts/check-boundary.mjs` fails when any of `admin-rust-app/Cargo.toml`, `core/Cargo.toml`, `app/Cargo.toml` lists `sqlx`, `diesel`, `postgres`, `tokio-postgres`, `sea-orm`, or `prisma-client-rust`, or when `core/src` or `app/src` holds database code; then extend `scripts/check-boundary.mjs` (Principle I, R11)
- [ ] T017 [P] `admin-rust-app/Dockerfile` and `admin-rust-app/nginx.conf` per R11: build stage `rust:<pinned>` plus `wasm32-unknown-unknown` and pinned prebuilt `trunk`; `ARG`→`ENV` for `QP_API_BASE_URL`, `QP_OIDC_AUTHORITY`, `QP_OIDC_CLIENT_ID`; dependency layer built from `Cargo.toml`/`Cargo.lock` with stub sources; copies `contracts/openapi.yaml`, `packages/shared/src/web/theme.css`, and `admin-app/src/styles.css` at their repository paths (R8); `trunk build --release`; serve stage `nginx` with `location = /health` (`{"status":"ok"}`), SPA fallback, `Cache-Control: no-store` on `index.html`, `X-Content-Type-Options: nosniff`, listen 5176 (copy `admin-app/nginx.conf`'s pattern, parity S2c, S14)
- [ ] T018 Add service `admin-rust-app` to `docker-compose.yml` exactly as contract sign-in-realm.md's Compose table: build args, `5176:5176`, `depends_on` `backend: service_healthy` and `seed: service_completed_successfully`, health check `wget -qO- http://127.0.0.1:5176/health`; no service depends on it (FR-019). Add `ADMIN_RUST_OIDC_AUTHORITY=http://localhost:8080/realms/queuepass-admin-rust-app` to `.env.example`
- [ ] T019 [P] `scripts/run-host.mjs`: start `trunk serve --port 5176` in `admin-rust-app/` with the three `QP_*` variables; add 5176 to `E2E_PORTS` in `scripts/e2e.mjs`; extend `scripts/test/run-host.test.mjs` and `scripts/test/e2e-ports.test.mjs` first
- [ ] T020 [P] *(test first)* `scripts/test/coverage-report.test.mjs`: `WORKSPACES` includes `admin-rust-app` and `--clean` removes its `coverage/`; then add it to `scripts/coverage-report.mjs`. Write `admin-rust-app/scripts/coverage-summary.mjs`, converting `coverage/llvm-cov.json` (`data[0].totals.lines.{count,covered,percent}`) into `coverage/coverage-summary.json` as `total.lines.{total,covered,pct}`. Add `@queuepass/admin-rust-app` to the root `test` script after `@queuepass/admin-app` (R9, R12)

### `core` foundations

- [ ] T021 **Spike first**: `admin-rust-app/core/build.rs` loads `contracts/openapi.yaml`, adds every `components.schemas` entry to a `typify::TypeSpace` by name so the `$ref: '#/components/schemas/X'` resolve (`add_ref_types`, as `progenitor` does), and writes the types to `OUT_DIR`, included as `core::api::types`. Any schema that fails is listed in the impl PR and hand-written in `core/src/api/types_manual.rs` (R5). Include the 038 and 039 schemas (`LayoutFile`, `LayoutDrawing`, `LayoutDrawingInput`, `VenueMap`, `SeatMapChange`, …)
- [ ] T022 *(test first)* [P] `core/tests/contract_types.rs`: each hand-written type serializes to a fixture that validates with `jsonschema` against `components.schemas.<Name>`; for generated types, one example per resource deserializes
- [ ] T023 *(test first)* `core/tests/api_client.rs` (`wiremock`): every call sends `Authorization: Bearer <token>`; a `4xx`/`5xx` with the contract error shape becomes `ApiError { status, code, message, details }`; a network failure becomes `Unreachable`; a non-envelope error body becomes `VALIDATION_FAILED` "Request failed with status {n}." marked not enveloped (parity S11); a 401 asks for sign-in with `returnTo` (S2b)
- [ ] T024 `core/src/api/client.rs`: `ApiClient { base_url, token source }` over `reqwest`, `ApiError`, and one function per operation `admin-app/src/api/*.ts` calls (events, images, layouts, locations, orders, reports, seating, tiers, hello), with the same paths, methods, and bodies; include the 038 and 039 layout, seating, venue-map, and drawing operations (parity M2–M4, M8–M11, M16, LE81)
- [ ] T025 *(test first)* [P] `core/tests/auth_state.rs`: the `AuthState` transitions of data-model.md (sign-in with role → `SignedIn`; no `queuepass-admin` → `WrongRole`; renewal before expiry; refresh failure → `RenewFailed`, retried once at once, then every 30 s and on `online`, → `SignedIn`; refresh refused → `SigningIn`; log out from any signed state, dropping a renewal that answers meanwhile; Backend unreachable → `Unreachable`); `returnTo` kept across sign-in (pathname + search, only when it starts with `/`); an in-memory `PkceStore` is empty after the code exchange. Mirror `packages/shared/test/web/auth-provider.test.tsx` (parity S1–S3)
- [ ] T026 `core/src/auth/`: `AuthState` machine, `PkceStore` trait, token expiry and renewal schedule from an injected clock (no `std::time::SystemTime`), role check from the access token's realm roles, no I/O
- [ ] T027 *(test first)* [P] `core/tests/time.rs`: port the cases of `admin-app/test/event-form-times.test.ts`, `format.test.ts`, `event-default-times.test.tsx`, `event-form.tz.test.tsx`, `times.tz.test.tsx`, and the `packages/shared/test/` cases for `time-zone.ts` and the doors-open helpers in `event.ts`: venue-zone local ↔ instant, skipped local time refused with the React message, repeated time chosen by offset, display with the zone made clear, "next whole hour" and "+4 hours" defaults (036 FR-017), 15-minute doors steps 0–6 h
- [ ] T028 `core/src/time.rs` and `core/src/format.rs` (`chrono`, `chrono-tz`) passing T027 (R6)
- [ ] T029 *(test first)* [P] `core/tests/money.rs`: port the money cases of `admin-app/test/format.test.ts` and `fixtures-005.ts` for `money.ts`, `BASE_PRICE_PATTERN` from `packages/shared/src/event.ts`, and `priceCents`/`formatPrice` from `venue-map/map-state.ts` ("$95", "$60.50", "$1,200") (parity R3, M15); then `core/src/money.rs` (no floating point)
- [ ] T030 *(test first)* [P] `core/tests/theme.rs`: parse `packages/shared/src/web/theme.css` and `admin-rust-app/style/red.css`: exactly the 14 look tokens of R8 are redefined in `red.css`, in light and dark, no other token is, and `red.css` holds only custom properties (no selector rule); every text-on-surface and control pair passes AA (4.5:1 text, 3:1 controls and focus) with `red.css` over the shared values, light and dark; then `core/src/theme.rs` (the parser and contrast math) (R8, R9)
- [ ] T031 *(test first)* [P] `core/tests/seating_geometry.rs`: port `packages/shared/test/layout-geometry.test.ts`, `web/row-labels.test.ts`, `seating.test.ts` (`LAYOUT_LIMITS`, `LEVEL_COLORS`), `venue-map/map-geometry.test.ts`, and the pure cases of `venue-map/use-pan-zoom.test.ts`; add `scripts/seat-map-parity-fixtures.mjs`, which imports the TypeScript functions unchanged and writes their outputs for fixture inputs (paths, label runs, generated blocks, views) to `core/tests/fixtures/seating/expected/`; the Rust output must equal them (R13)
- [ ] T032 `core/src/seating/{geometry,map_geometry,pan_zoom}.rs` passing T031: `moveBy`, `turnAbout`, `normalizeAngle`, `outlineAround`, `rowLabels`, `checkBlock`, `seatCounts`, `generateBlock`, `placeBlock`, `outlinePath`, `bounds`, `centroid`, `sectionViewBox`, `fitView`, `zoomOf`, `zoomAt`, `panBy`, `clientToMap`, `pinchView`, `zoomToTarget`, `keyAction`, `wheelFactor`, `easeOutCubic`, `isDrag`, `fitOf`, `mapAspect`, `labelFontSize`, with their constants (R13). `fitOf` and the exports of `use-pan-zoom`, `map-geometry`, and `layout-geometry` are ported by name; `zoomToTarget`, `keyAction`, `wheelFactor`, `easeOutCubic`, `isDrag`, `mapAspect`, and `labelFontSize` are new Rust names for logic the React code writes inline

### App shell (User Story 1's frame, used by every story)

- [ ] T033 `app/src/config.rs`: `QP_API_BASE_URL`, `QP_OIDC_AUTHORITY`, `QP_OIDC_CLIENT_ID` via `env!` (R11). `app/src/oidc_glue.rs`, **proved end to end before any screen work**: `openidconnect` discovery with `ProviderMetadataWithLogout`, authorization-code request with PKCE `S256` and scope `openid profile` (verifier and `state` in `sessionStorage` through a `PkceStore` impl, removed at once after the exchange), code exchange (a failed exchange drops the code from the URL and signs in again), ID-token validation (confirm Keycloak's `/certs` sends CORS headers to 5176, or record the R3 fallback), refresh grant, `returnTo`, back-forward-cache re-check on `pageshow`, RP-initiated logout via `end_session_endpoint` with `id_token_hint`; time from `js_sys::Date::now()`; driving `core::auth` (R3, parity S1–S3)
- [ ] T034 `app/src/shell.rs`, `app/src/main.rs`, `app/src/routes.rs`: "Signing in…" before sign-in; the sticky header with the same elements and classes as `admin-app/src/App.tsx` (Q mark, brand "QueuePass Admin (Rust)" → `/locations`, nav Venues, Events, Reports with prefix-matched `navlink--active` and `aria-current`, "Log out"; no username); the wrong-role card (S4); the unreachable banner (S5); `/` showing `/hello/admin` (S6); the error banner with the conflict look (S9); one-time notices cleared from history (S10); every route of parity S13, with `main.main--full` on `/locations/:id/layouts/*`; the router's default not-found screen (S12); `app/src/guard.rs`, the navigation guard of R15 (used by US6), with every in-app link and navigation going through it

**Checkpoint**: `docker compose up --build` brings up `admin-rust-app`. In the Rust Admin app you can sign in, see the home page, and log out.

---

## Phase 3: User Story 1 — Sign in next to the React app (P1) 🎯 MVP

**Goal**: both Admin apps signed in at once; Rust is red and named; logging out of one leaves the other.
**Independent test**: quickstart S1.

- [ ] T035 *(test first)* [US1] `e2e/fixtures/apps.ts`: add key `'admin-rust'`: `{ url: 'http://localhost:5176', name: 'QueuePass Admin (Rust)', role: 'admin' }`; add the entry to every `Record<AppName, …>` (`e2e/tests/001-sign-in.spec.ts`, `027-sign-in-background.spec.ts`, `028-app-realms.spec.ts`) so `tsc -p e2e` passes; add an `adminApp` fixture (default `APPS.admin`, `APPS['admin-rust']` in project `admin-rust`) and the `admin-rust` project with `grep: /@admin/` to `e2e/playwright.config.ts` (R10)
- [ ] T036 *(test first)* [US1] `e2e/tests/037-rust-admin-app.spec.ts`: test `037 S1: both Admin apps stay signed in, and logging out of one leaves the other`: sign in to both in one context; the sign-in heading reads "Sign in to QueuePass Admin (Rust)"; header and tab title contain "(Rust)"; the header and page background computed colors are the red tokens; after sign-in no PKCE value is left in `sessionStorage` and nothing in `localStorage`; opening `/events` signed out lands on Events after sign-in (`returnTo`); log out of Rust then React is still signed in after reload, and the reverse
- [ ] T037 [US1] `e2e/tests/028-app-realms.spec.ts`: add the Rust Admin app as a fourth app in the one-window test; update its title and, in the same commit, the matching Automated row in `specs/028-app-realms/quickstart.md`
- [ ] T038 [US1] Make T036 and T037 pass (fix shell, glue, seed, or theme as needed)
- [ ] T039 [US1] Tag the Admin journeys with Playwright's details object, `test('…', { tag: '@admin' }, …)`, never inside the title, and switch their Admin steps from `'admin'` to `adminApp`: `001`, `002`, `003`, `020`, `024`, `025`, `030`, `031`, `035`, `036`, the Admin steps of `015`, `038 S0`, `038 S5`, `038 S6`, `038 S17`, `039 S1/S2/S3`, and `039 S5` (R10); Customer-app steps stay on the Customer app. Leave untagged, with a comment, any step that checks the React app's own code. Existing titles stay unchanged

**Checkpoint**: User Story 1 shippable. Commit, and keep going.

---

## Phase 4: User Story 2 — Venues and their layouts (P1)

**Goal**: parity items V1–V10, M1–M7. **Independent test**: quickstart S2.

- [ ] T040 *(test first)* [P] [US2] `core/tests/venue_form.rs`: port the cases of `admin-app/test/section-lines.test.tsx`, `layout.test.tsx`, `venue-create.test.tsx`, `venue-address.test.tsx`, `venue-time-zone.test.tsx`, the venue-form checks and messages (V2, V3, V8–V10), and the `packages/shared/test/` cases for `location.ts` (`US_STATES`, `ZIP_PATTERN`) and `time-zone.ts`' zone list
- [ ] T041 [P] [US2] `core/src/forms/venue.rs` and `core/src/forms/section_lines.rs` (`LinesDraft`, `toLinesInput`, `lineSeats`, `totalSeats`, `newLine`, the level rename cascade, the "Choose a level" option rule, `draftOf`) passing T040
- [ ] T042 *(test first)* [P] [US2] `core/tests/layouts_card.rs`: port `admin-app/test/layouts-card.test.tsx`'s logic: the summary line (`countText`, grouped, singular at 1), the import checks (over 4,194,304 bytes; not JSON) and their messages, the problem list ("{message} ({path})", "and {more} more", `details.fields`), the largest-layout capacity (M7); then `core/src/forms/layouts.rs`
- [ ] T043 [US2] `app/src/pages/venue_list.rs`: V1 (head, search card with `?q=`, table columns, the empty and error states)
- [ ] T044 [US2] `app/src/pages/venue_form.rs` and `app/src/components/section_lines.rs`: create and edit, every field and hint of V2, V8, V9; one-step save with the verified or not-verified notice (V3); New venue › Seated making the "Standard" layout and the "Seating layout not saved" banner (V10); the read-only capacity while the venue has layouts (M7); refusals as V4
- [ ] T045 [US2] `app/src/venue_map/layout_preview.rs` (M6), then `app/src/pages/venue_detail.rs`: V5 (address link as `address-link.tsx`, notes, capacity from layouts, Events here with the past toggle) and V7 (delete with confirmation and its outcomes)
- [ ] T046 [US2] `app/src/components/layouts_card.rs`: M1–M5 (states, items, locked note, preview, Edit/View links, Rename, Edit section lines, Duplicate, Delete with confirm, one write at a time, the item's refusal banner, the import field and its problems, "New layout", the lines form), reloading the venue's capacity after each load
- [ ] T047 [US2] `e2e/tests/037-rust-admin-app.spec.ts`: test `037 S2: a venue and its layout made in the Rust Admin app show in the React Admin app` (a seated venue with two lines; renamed in React and read in Rust; duplicated, lines edited, and a bad file imported in Rust); make `024` and `038 S5` pass in project `admin-rust` (`038 S0` ends on the event page, so T064 makes it pass)

---

## Phase 5: User Story 3 — Schedule and edit events (P1)

**Goal**: parity items E2–E8, E15, E16, M8–M11. **Independent test**: quickstart S3.

- [ ] T048 *(test first)* [P] [US3] `core/tests/event_form.rs`: port every case of `admin-app/test/event-form-checks.test.ts`, `event-form-flow.test.tsx`, `event-doors-open.test.tsx`, `capacity.test.tsx`, `event-types-edit.test.tsx`, `event-create-atomic.test.tsx`, `EventForm.conflict.test.tsx`, `ticket-limit.test.tsx`, `seating-section.test.tsx`, and `event-seating-create.test.tsx`: each field check and message, when it shows, first field at fault and its focus target, the general-admission seat line, the seated checks and placement (M11), the lock rule (`lockReason`, M8), the request bodies and base price (E6, M11)
- [ ] T049 [P] [US3] *(test first)* `core/tests/off_sale.rs`: port `off-sale.ts`'s cases (from `seating-section.test.tsx` and `fixtures-038.ts`): `seatKey`, `offSeatsOf`, `compactSection`, `ordered`, `withSectionOff`, `countOffSale`, the whole-section and row rules, toggling skips taken seats, `seatRadius`; then `core/src/forms/off_sale.rs`
- [ ] T050 [US3] `core/src/forms/event.rs`: `EventFormState` of data-model.md and the checks, totals, focus order, refusal placement, and request builders, passing T048
- [ ] T051 *(test first)* [P] [US3] `core/tests/images.rs`: port the `packages/shared/test/event-image.test.ts` cases (`readImageHeader` type sniffing, size limit, pixel limits) and `admin-app/test/images-field.test.tsx`'s per-file notes and preview shapes; then `core/src/forms/images.rs` (parity E4b)
- [ ] T052 [US3] `app/src/pages/event_form.rs` fieldset "Venue and times" (E2): name, venue, doors open in two modes with the live preview, Starts and Ends as date and time controls in the venue zone, the zone line, the repeated and skipped time questions, the new-event defaults and their recomputation
- [ ] T053 [US3] Fieldset "Tickets and seating": the Seating select and its lock (M8); general admission (E15); `app/src/components/seating_section.rs` with the preview, the price table and "Prices from" note (M9), the seat line, and the off-sale tool with its section SVG (M10)
- [ ] T054 [US3] Fieldset "Details" (E4, E4b): tickets per customer; `app/src/components/images_field.rs`
- [ ] T055 [US3] Submit and refusals (E5–E7, E16, M11): never send a known problem, focus the first field at fault, save all or nothing, then pictures in order with the create and edit failure messages, "Event saved." and the 700 ms move, the no-answer banner; Backend refusals placed and focused, values kept; the scheduling conflict and its detail
- [ ] T056 [US3] Edit mode (E8): load the event, its types, and its seating; lock controls with the reason; details-only when they could not be read; save through the update request
- [ ] T057 [US3] `e2e/tests/037-rust-admin-app.spec.ts`: test `037 S3: events scheduled in the Rust Admin app, general admission and on a layout, read the same in the React Admin app` (the journeys that end on the event page pass in T064, once T061 and T063 build it)

---

## Phase 6: User Story 4 — Events, sales, and the live venue map (P2)

**Goal**: parity items E1, E9–E14, E17, M12–M17. **Independent test**: quickstart S4.

- [ ] T058 *(test first)* [P] [US4] `core/tests/seat_stream.rs`: port `packages/shared/test/web/seat-stream.test.ts` (the SSE parser: named events, multi-line data, comments, CRLF and lone CR) and `venue-map/map-state.test.ts` (`mapReducer` with map, change, section, and reset; `seq` rules; 500 kept changes; clamped counts); the reconnect policy (at once after a map then an end; else 1 s, 2 s, then every 5 s; stop on 404), the section retry (1, 2, 4, 8, then every 10 s on no answer or 5xx; none on a 4xx, the known quirk), and the status mapping (parity M16); then `core/src/api/seat_stream.rs` and `core/src/seating/map_state.rs`
- [ ] T059 *(test first)* [P] [US4] `core/tests/venue_map.rs`: port the logic of `venue-map/venue-map.test.tsx` and `admin-app/test/event-seat-map.test.tsx`: `stateCounts`, `sectionState`, the section and seat accessible names, the legend lists, `seatLook`, `seatTip`, `seatSpacing`, row label positions, the mark geometry, and the totals line (M12–M15); then `core/src/seating/venue_map.rs`
- [ ] T060 [US4] `app/src/pages/event_list.rs`: E1 and E17 (head, search card with its URL keys, Show past events, columns, the three empty states, load error)
- [ ] T061 [US4] `app/src/pages/event_detail.rs`: E9 (gallery band, details, the image gallery and full-size viewer as `image-gallery.tsx`, `image-viewer.tsx`, `use-gallery-rotation.ts`) and E14 (cancel and delete with confirmation and their outcomes)
- [ ] T062 [P] [US4] `app/src/components/tiers.rs` (E10) and `app/src/components/sales_card.rs` (E11, with the levels table)
- [ ] T063 [US4] `app/src/venue_map/{venue_map,section_view,legend,pan_zoom}.rs` (M13–M15, with the pointer, wheel, pinch, key, and animation glue of R13), `app/src/seat_stream.rs` (streaming `fetch` with the `Authorization` header, M16), and `app/src/components/event_seat_map.rs` (the Seating card, M12)
- [ ] T064 [US4] `e2e/tests/037-rust-admin-app.spec.ts`: test `037 S4: the Rust Admin app's event page shows live seats, sales by level, and edits tiers` (a seat held and then sold from the Customer app appears without a reload, in the section counts and zoomed in; the Sales card shows it by level; a tier price edit on a general-admission event shows in the React Admin app); make `002`, `003`, `015` (Admin steps), `020`, `025`, `030`, `031`, `035`, `036`, `038 S0`, `038 S6`, and `038 S17` pass in project `admin-rust`

---

## Phase 7: User Story 5 — Attendees, reports, downloads (P2)

**Goal**: parity items A1–A3, R1–R3, X1–X5. **Independent test**: quickstart S5.

- [ ] T065 *(test first)* [P] [US5] `core/tests/export_rows.rs`: port the cases in `admin-app/test/export/` (`attendee-rows`, `sales-rows`, `file-name`, `csv`, `xlsx`, `xlsx.tz` (a `.test.tsx` file), `pdf`, `pdf.fit`), `attendees.test.tsx` (the ticket code details, A3), `attendees-export.test.tsx`, and `reports-export.test.tsx`. Add input fixtures `core/tests/fixtures/export/*.json` (seated and levelled tickets included) and the React app's output for them (rows and the CSV text) in `core/tests/fixtures/export/expected/`, made once by a new script `scripts/export-parity-fixtures.mjs` that imports `admin-app/src/export/*.ts` without changing it; the Rust output must equal it (SC-004)
- [ ] T066 [US5] `core/src/export/{rows,table,made,file_name}.rs` passing T065; "Made by <username>", the time-zone note, the Attendees privacy note; the made-at time and file name in a zone passed in by the caller (X4)
- [ ] T067 *(test first)* [P] [US5] `core/tests/export_files.rs`: CSV equals the React CSV for each fixture byte for byte, apart from the `Exported at` column's values (BOM, CRLF, quoting, formula prefix including tab and CR: X1); XLSX read back with `calamine` (dev-dependency) has the same cells, typed numbers, dates, and money, and the "About" sheet (X2); PDF text extracted with `lopdf` (dev-dependency) has the title, notes, header on every page, "Page n of m", and every row, with a missing character as `?` and `REPLACED_NOTE` (X3); all three formats at 5,000 and 25,000 tickets (X5, as `admin-app/test/export/size.test.ts`)
- [ ] T068 [US5] `core/src/export/{csv,xlsx,pdf}.rs` (`csv`, `rust_xlsxwriter` `wasm` feature, `printpdf` with embedded Noto Sans, the React file's indigo header color, and a repeated-header table layout with `nowrap` columns) passing T067 (R7)
- [ ] T069 [US5] `app/src/device_zone.rs` (the admin's zone via `js_sys::Intl::DateTimeFormat`, R6), `app/src/download.rs` (Blob plus temporary `download` link, as `admin-app/src/export/save.ts`), and `app/src/components/export_menu.rs` (the `<details>` menu, its group, privacy note, status, failure text, one download at a time, as `ExportMenu.tsx`)
- [ ] T070 [US5] `app/src/pages/attendees.rs` (A1, A3: head, columns with Price level, ticket code details, "Check-in details removed on …", the Download menu)
- [ ] T071 [US5] `app/src/pages/reports.rs` (R1, R2: head with "as of", the four tiles with meters, By event table, Download menu)
- [ ] T072 [US5] `e2e/tests/037-rust-admin-app.spec.ts`: test `037 S5: attendees, reports, and every download in the Rust Admin app` (table contents and report figures match the React Admin app's for the same event; each of the six downloads produces a file with the expected name; the 5,000-ticket PDF downloads in the Rust app)

---

## Phase 8: User Story 6 — The layout editor (P2)

**Goal**: parity items LE1–LE81. **Independent test**: quickstart S10.

- [ ] T073 *(test first)* [P] [US6] `core/tests/editor.rs`: port every case of `admin-app/test/layout-editor/editor-doc.test.ts`, `editor-state.test.ts`, and `overlap.test.ts`, and the logic cases of `AddSectionForm.test.tsx`, `SaveBar.test.tsx`, `SelectionPanel.test.tsx`, `SectionSeatsView.test.tsx`, `EditorCanvas.test.tsx`, `LevelsPanel.test.tsx`, `level-picker.test.tsx`, `guide.test.tsx`, `keyboard.test.tsx`, and `LayoutEditor.test.tsx` for the pieces R14 moves into `core` (`readDraft`, the First-row reset, `missingParts`, `sectionIndexOf`, the problem list, the confirm texts, `seatsInBox`, `mapFit`, turn snapping, handle and box placement, the floor stretch, the number display, the level picker's value, the guide's done flags and `hintFor`, `listed`, the title rule); fixtures from `admin-app/test/layout-editor/fixtures.ts`
- [ ] T074 [US6] `core/src/editor/{doc,state,overlap,draft,save,view}.rs`: the reducer with every action and message, history, Undo and Redo, id remapping, and the moved pieces, passing T073 (R14). Copy the quirks the checklist names (LE38, LE48, LE56, LE58)
- [ ] T075 [US6] `app/src/layout_editor/page.rs`: routes and loading (LE1, LE3), the guard through `guard.rs` with the unguarded moves (LE4, R15), title and Back link (LE6), the edit-mode layout (LE7, LE8), phone width (LE9), the guide and hint (LE10, LE11), the toolbar with name, Undo, Redo, and the save bar (LE67–LE72, LE76–LE79), Save as a new layout and Reload, the locked view and Duplicate to edit (LE75), the status line (LE80)
- [ ] T076 [US6] `app/src/layout_editor/canvas.rs`: the SVG map (LE21–LE35) and the zoomed section (LE44–LE47) with pointer capture, drag, turn handle, floor handles, box select, pan and zoom from `core::seating::pan_zoom`, and the map keys (LE60, LE61)
- [ ] T077 [US6] `app/src/layout_editor/{sections_panel,add_section,selection_panel,levels_panel,level_picker,number_box,commit_box}.rs`: LE12–LE20, LE36–LE43, LE48–LE58, LE62, LE63, and the editor-wide undo keys (LE59)
- [ ] T078 [US6] `e2e/tests/037-rust-admin-app.spec.ts`: test `037 S10: a layout drawn in the Rust Admin app's editor is the same in the React Admin app's, and a stale save is refused` (quickstart S10 steps 1–4, the guard on Back included); make `039 S1/S2/S3` and `039 S5` pass in project `admin-rust`

---

## Phase 9: Polish and cross-cutting

- [ ] T079 `e2e/tests/037-rust-admin-app.spec.ts`: test `037 SL: every page has the same structure and arrangement in both Admin apps, at desktop and phone width` (R15: every route of S13 with the same data in both apps, at 1280 px and 375 px, comparing `main`'s `ariaSnapshot()` with the app name normalized and the boxes of each card, form section, and table within 2 px); fix any difference in the Rust views (SL1–SL14, FR-020)
- [ ] T080 `.github/workflows/ci.yml`: in the `test` job, add a named step `npm run rust:setup` in the same place as in the root `ci` script, so `scripts/test/ci-workflow.test.mjs` still passes; add no other step and no cache. The `e2e` job's stack builds `admin-rust-app`, and both Playwright projects run. Record each job's time on the impl PR; if either is over 25 of its 30 minutes, say so and propose the 011 amendment of R12 instead of working around it. `README.md`: Rust Admin app URL `http://localhost:5176`, the same admin accounts in its own realm, `rustup` plus `npm run rust:setup` for host builds and tests, and that the first Docker build takes minutes
- [ ] T081 `npm run ci` green: format, lint (both clippy runs), build, `npm test` (`admin-rust-app` ≥ 80% lines on `core`, in the coverage report), `npm run coverage:report`; and `npm run e2e` green. Then the parity walk: go through `contracts/parity-checklist.md` and tick every item E, U, or M in the impl PR description, adding rows for Admin changes merged after `ff993c4` (T001); fix the checklist where the React app differs. Then the running-system gate from a fresh clone: `docker compose up --build`, seed succeeds the first time, sign in, use, and log out of all four front ends; run `037 S1` with `--repeat-each=10` (SC-007); record the date. Hallway test (quickstart S9, SC-003): 5 people, both apps, record the result
- [ ] T082 Update `quickstart.md`'s Automation rows S1–S5, S10, and S11 to Automated with their exact test titles; `node scripts/check-quickstart-marks.mjs` passes. Independent review by a Claude session that did not write the implementation; fix findings; record the review in the impl PR description; open the PR with `fixes #163` in its description

---

## Dependencies

- Phase 1 → Phase 2 → every story. Within Phase 2, T021 (typify spike) and T033 (sign-in proved
  end to end) come first: they carry the most technical risk. T031–T032 (geometry) come before
  any map screen.
- US1 (Phase 3) is the MVP and needs only Phase 2. T039 (tagging the journeys) comes before the
  "pass in `admin-rust`" parts of T047, T064, and T078. Every journey that ends on the event page
  is made to pass in T064, after T061 and T063 build that page, not in T047 or T057.
- US2 → US3 (the event form needs venues with layouts to pick). US4 and US5 need events, so they
  come after US3, but they are independent of each other. US6 needs US2's Layouts card links
  (T046) and US4's pan and zoom glue (T063).
- Phase 9 after all stories.

## Parallel examples

- Phase 1: T004–T007 together.
- Phase 2: T008, T009, T010, T014, T015, T016, T017, T019, T020 together (different files); then
  T022–T032 in `core`, each test task in parallel with other areas' tests.
- US2: T040–T042 (`core`) in parallel with T043 (list page).
- US3: T048, T049, and T051 (tests) together.
- US4 and US5 can run side by side once US3 is done: T058–T064 and T065–T072.
- US6's `core` work (T073, T074) can start any time after T032, in parallel with US2–US5.

## Implementation strategy

1. **MVP**: Phases 1–3. The Rust Admin app is up, red, signed in beside the React app, and logged
   out independently. It is a constitution "stub front end" and safe to demo.
2. Add venues and layouts (US2), then events (US3): the app is now usable for real admin work.
3. Add the read-only pages and the live venue map (US4), then attendees, reports, and downloads
   (US5).
4. Add the layout editor (US6): full parity.
5. Polish: the same-layout check, CI, README, parity walk, fresh-clone gate, hallway test, review,
   PR.
