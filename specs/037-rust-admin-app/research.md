# Research: Rust Admin App

**Feature**: `037-rust-admin-app` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

Each decision below resolves an unknown from the plan's Technical Context. "React Admin app" means
`admin-app/`. "Rust Admin app" means the new `admin-rust-app/`.

## R1. App shape: browser app compiled to WebAssembly

**Decision**: The Rust Admin app is a client-side app compiled to WebAssembly. It is served as
static files by nginx, as the React Admin app is, and calls the Backend from the browser.

**Rationale**: This keeps every architectural rule the React Admin app already meets. It is a public
OIDC client with PKCE, holds tokens in browser memory only (Principle V), talks to the Backend only
over its REST API (Principle I), and runs as one static container with a health check (Principle
II). Nothing new runs on a server, so there is nothing new to secure.

**Alternatives considered**:
- *Server-rendered Rust app (Axum with HTML templates and htmx)*: The server would hold the tokens
  (a backend-for-frontend), which needs a confidential client, a client secret, and a server-side
  session. That breaks Principle V's public PKCE client and in-memory tokens, and it adds a second
  server.
- *Desktop app (Tauri, egui)*: It is not a web front end, can't be reached at an address, and can't
  run in Compose or Playwright.

## R2. UI framework: Leptos (client-side rendering), built with Trunk

**Decision**: Leptos 0.8 in client-side-rendering mode, built by Trunk. Exact versions are pinned in
`Cargo.lock` and `rust-toolchain.toml` when the implementation starts, at the then-current stable
releases.

**Rationale**: Leptos has fine-grained signals that map directly onto the React app's state
(form fields, the live seat totals, live seat-map updates). It has a router with nested
routes and URL parameters (`/events/:id/edit`), and it is the most actively maintained of the Rust
web frameworks, with the most examples. Trunk is the standard build tool for a Leptos CSR app: one
`index.html`, hashed assets, and a `trunk build --release` that drops a `dist/` for nginx, just as
`vite build` does now.

**Alternatives considered**:
- *Yew*: Mature, React-like components and hooks. It is slower moving, and its virtual DOM and
  message-passing patterns make forms with many fields wordier than Leptos signals.
- *Dioxus*: React-like and cross-platform (web, desktop, mobile). Its web target is fine, but the
  cross-platform tooling (`dx`) is heavier than this app needs, and it has fewer examples of OIDC
  and file download in the browser.
- *Sycamore*: Similar to Leptos, but a smaller ecosystem.

## R3. Sign-in: the `openidconnect` crate, authorization code with PKCE, tokens in memory

**Decision**: Use the `openidconnect` crate (standards-based OIDC; its `reqwest` HTTP client works
in WebAssembly) for discovery, the authorization-code request with PKCE (`S256`), the token
exchange, ID token validation, the refresh-token grant, and RP-initiated logout through the
realm's `end_session_endpoint`. Behavior matches `packages/shared/src/web/auth-provider.tsx`:

- Tokens stay in a Leptos signal (memory) only. Only the one-time PKCE verifier and `state` cross
  the redirect, in `sessionStorage`, and are removed at once (the same exception the React app's
  `oidc-client-ts` uses, spec 018 R12).
- Renewal: a refresh-token grant shortly before the access token expires, with no page navigation.
  While a renewal has failed, retry with the refresh token, as the React provider does. If the
  refresh token is refused, sign in again.
- A reload loses the in-memory tokens and starts sign-in again, which Keycloak's own session
  answers without asking for the password, as today.
- No role in the token: show the wrong-role page (plain message, no data, Log out), as
  `wrong-role.tsx` does.
- After sign-in, return to the page that was asked for (the React provider's `returnTo` state;
  the `002` and `015` browser tests rely on it).
- When the page is shown from the back-forward cache, check sign-in again, and serve
  `index.html` with `Cache-Control: no-store` (spec 001 SC-007, as `admin-app/nginx.conf` does).
- While a renewal has failed, retry every 30 s and when the browser comes back `online`, as the
  React provider does.

WebAssembly details, settled by a sign-in spike first (tasks T029):
- `getrandom`: version 0.3 needs both its `wasm_js` feature and
  `--cfg getrandom_backend="wasm_js"` (set in `admin-rust-app/.cargo/config.toml`). Version 0.2
  needs its `js` feature. Pin whichever `openidconnect` pulls in.
- Use `ProviderMetadataWithLogout`, so discovery yields `end_session_endpoint`.
- Read time with `js_sys::Date::now()` (or the `web-time` crate), never `std::time::SystemTime`,
  which panics in `wasm32-unknown-unknown`.
- Discovery and ID-token validation fetch the realm's JWKS from the browser. The spike confirms
  Keycloak's `/certs` answers the app's origin with CORS headers. If it doesn't, skip ID-token
  signature checks in the browser, because the Backend validates every access token anyway.
  Record that in the impl PR.

**Rationale**: The constitution requires a standards-based OIDC client library, not a
Keycloak-only adapter. `openidconnect` is the standard Rust OIDC client and supports every step the
React app uses.

**Alternatives considered**:
- *`oauth2` crate alone*: It covers PKCE and token exchange but not ID token validation or
  discovery, so more hand-written code would sit on the security path.
- *Call `oidc-client-ts` through JavaScript interop*: The app would no longer be Rust where it
  matters most, and it would need an npm build inside the Rust build.
- *A hand-written PKCE flow*: Ruled out by the constitution's standards-based library rule.

## R4. Its own realm and client

**Decision**: A fourth realm, `queuepass-admin-rust-app`, with one public client `admin-rust-app`,
realm role `queuepass-admin`, and users `admin1`–`admin5` (password `test123`). It is added as a
fourth row of `APP_REALMS` in `packages/shared/src/realms.ts`:
`{ app: 'admin-rust', realm: 'queuepass-admin-rust-app', clientId: 'admin-rust-app', role: 'queuepass-admin', prefix: 'admin', count: 5 }`.
The seed's and the browser tests' import-free copies follow (their equality test already guards
this).

That one row does most of the work:
- The Backend's `AuthGuard` and `JwksProvider` build their trusted issuers and key sets from
  `APP_REALMS`, so the new realm is trusted, and only `queuepass-admin` from it is honoured
  (spec 028 FR rules), with no other code change.
- The seed's realm, client, role, user, and login-theme provisioning loops over the rows, so the
  realm comes up with no manual step and reruns converge (FR-008).
- The client gets the same `queuepass-api-audience` mapper as the others, so its tokens carry
  the API audience the Backend checks.

The client's exact redirect URI and web origin follow from its port, 5176, the same way
`provision-clients.ts` builds them for the other clients (R11). Its client name is
`QueuePass Admin (Rust)`, which the sign-in page shows (spec 021).

**Rationale**: A second client in `queuepass-admin-app` would share one Keycloak session. Signing
out of either Admin app would end it for both, which `028` and Principle V forbid (spec FR-005).
Admin data is not tied to the admin's subject (orders and holds are customers'), so separate
accounts in two realms change nothing an admin can see or do.

**Alternatives considered**: A second client in the existing admin realm was rejected because the
two apps would share one sign-in session (above).

## R5. Calling the API: types generated from the contract

**Decision**: The Rust Admin app's API types are generated from `contracts/openapi.yaml` at build
time by `typify` (JSON Schema to Rust types), run from `build.rs` over `components.schemas`. They
are wrapped in a small hand-written client module (`reqwest`, one function per operation the
React Admin app calls) that adds the `Bearer` token and maps the standard error shape
(`code`, `message`, `details`) into one `ApiError` type. Generated types are rebuilt on every
build, so they cannot drift from the contract. The live seat stream (spec 015) is read with a
streaming `fetch` and the token in the `Authorization` header, as
`packages/shared/src/web/seat-stream.ts` does. It reconnects at once when the server ends it at
token expiry.

If `typify` cannot express one of the contract's schemas, that one type is written by hand, and a
contract test checks it against the schema (serialize a fixture, validate it with the
`jsonschema` crate against `components.schemas.<Name>`). Principle I allows types "generated from,
or checked against" the document.

How the contract is fed to `typify`: the contract refers to its schemas 267 times as
`$ref: '#/components/schemas/X'`. `build.rs` loads `components.schemas` as a map and adds each
schema to a `typify::TypeSpace` by name (`add_ref_types`, the way `progenitor` does), so those refs
resolve without being rewritten. A spike in T020 builds every schema first. Any schema that fails
(for example a 2020-12 form `typify` does not support) goes to the hand-written list with its
contract test.

**Rationale**: Principle I. OpenAPI 3.1 schemas are JSON Schema 2020-12. `typify` handles the
forms the contract mostly uses (`type: [x, 'null']`, `oneOf`, `allOf`, `enum`), and the spike
settles the rest.

**Alternatives considered**:
- *`progenitor`*: It generates a whole client, but it reads OpenAPI 3.0 only, and the contract is
  3.1.
- *`openapi-generator` (Rust target)*: It needs a Java toolchain in the build, and its 3.1 support
  is partial.
- *Hand-written types everywhere, each checked*: This works, but it is more code to keep in step by
  hand.

## R6. Times and time zones: `chrono` and `chrono-tz`

**Decision**: Event and doors-open times are entered and shown in the venue's time zone (spec 020)
with `chrono` and `chrono-tz`. `LocalResult::None` is a skipped local time, refused with the same
message as the React app. `LocalResult::Ambiguous` is a repeated time, chosen by its offset as in
`020`. The time logic (`event-form-times.ts`, `event-form-checks.ts`, `format.ts`) is ported as
plain functions with their unit tests, so they run natively and count toward coverage (R9).

One exception uses the browser: the admin's own device time zone. The React app reads it with
`Intl` (`deviceZone()`) for each download's "made at" time and its file name. The Rust app reads
it once in the `app` crate with `js_sys::Intl::DateTimeFormat` (`resolvedOptions().timeZone`) and
passes it into `core` as a zone name, so `core` stays testable natively. The shared helpers the
React app uses (`packages/shared/src/time-zone.ts`, the doors-open helpers in
`packages/shared/src/event.ts`) are ported too, with their `packages/shared/test/` cases.

**Rationale**: The same rules can be tested natively, without a browser. `chrono-tz` bundles the
IANA database, so results don't depend on the browser's `Intl`.

**Alternatives considered**: *`Intl` through `js-sys`*: This matches the browser exactly, but it
can only be tested in a browser and is wordy from Rust.

## R7. Downloads: CSV, XLSX, PDF in Rust

**Decision**:
- **CSV**: the `csv` crate for quoting, plus what `export/csv.ts` adds by hand: a UTF-8 BOM,
  CRLF line ends, an `Exported at` column on every row, and a `'` prefix on any cell starting
  with `=`, `+`, `-`, or `@` (formula-injection guard). The same columns and order.
- **XLSX**: `rust_xlsxwriter` with its `wasm` feature. Numbers, dates, and money are written as
  typed cells with the React app's number formats (spec 023 FR: kept as data).
- **PDF**: `printpdf`, pinned to one minor version because its API changed a lot in 0.8, with a
  small table-layout module standing in for `jspdf-autotable`: header row repeated on each page,
  column widths, `nowrap` columns, page breaks. It embeds the same Noto Sans fonts as
  `export/pdf.ts`, and a character the font lacks becomes `?` with the same `REPLACED_NOTE`. The
  same title, "Made by <username>" line, made-at line, time-zone note, the Attendees privacy note,
  columns, and rows.
- **Size**: spec 023's size targets apply: an event of 5,000 tickets and one of 25,000 tickets
  (`admin-app/test/export/size.test.ts`). The `core` tests build all three formats at both sizes
  natively. One browser test downloads the 5,000-ticket PDF in the Rust app to show the
  WebAssembly build keeps up.
- Saving: a `Blob` and a temporary link with `download` (web-sys), as `export/save.ts` does. File
  names follow `export/file-name.ts`.

The row builders (`attendee-rows`, `sales-rows`, `table`, `made`, `file-name`) are ported as plain
functions shared by all three formats, so the three formats can't disagree, and they run natively
in tests.

**Rationale**: FR-015 and SC-004 require the same contents. One row builder per report, with three
writers, makes that checkable: a test feeds the same fixture to both apps' row builders and
compares.

**Alternatives considered**: *Calling `jsPDF` and `write-excel-file` through JavaScript interop*:
The exports would not be Rust. This is the fallback only for PDF, and only if `printpdf` can't do
the layout. Using it would need a note in the impl PR.

## R8. The red look on the React Admin app's layout

> **2026-11-14** (Clarifications, FR-020): rewritten before any implementation. The first version
> gave the Rust Admin app its own stylesheet and let its layout differ. It is now to look exactly
> like the React Admin app apart from its colors.

**Decision**: The Rust Admin app uses the React Admin app's stylesheets themselves, not copies, with
a red token set loaded after them:

1. `packages/shared/src/web/theme.css` (the shared theme: tokens, layout, buttons, cards, tables,
   banners, forms, the venue map's and the gallery's styles),
2. `admin-app/src/styles.css` (the Admin app's own screens, the Layouts card, the seating section,
   and the layout editor),
3. `admin-rust-app/style/red.css`, last: in the shared theme's app token blocks (`:root` and the
   `prefers-color-scheme: dark` block) it redefines exactly these 14 **look** tokens, light and
   dark: `--bg`, `--surface`, `--surface-alt`, `--border`, `--border-strong`, `--text`,
   `--text-muted`, `--text-faint`, `--accent`, `--accent-hover`, `--accent-soft`, `--accent-text`,
   `--brand-mark-end`, and `--brand-mark-text`. It leaves every other token as it is: the **data**
   colors `--danger*`, `--warn*`, `--ok*`, `--level-*`, `--map-*` (the `--map-state-*` set
   included), and `--seat-*`, because they carry meaning and a price level's color must be the
   same as on the Customer app's map (parity M17); the other apps' accents (`--accent-tickets*`,
   `--accent-booth*`, `--brand-mark-*-tickets`, `--brand-mark-*-booth`), which the Admin screens
   do not use; and `--stone-*`, `--scrim*`, `--qr-*`, `--shadow*`, and the font, radius, and space
   tokens. It holds custom properties only: no selector rule, and no layout, size, spacing, or type
   rule.

Trunk links all three from `admin-rust-app/index.html` (`<link data-trunk rel="css" href="…">`,
paths relative to `index.html`, so `../packages/…` and `../admin-app/…`; the repository root is
already the Docker build context of every app), in
that order, as `admin-app/src/main.tsx` imports the first two. The Leptos views use the same element
structure and the same `class` values as the React components, so the same rules apply. The
React files are not changed.

The red set: accent `#b3261e` (about 6.5:1 on white), its hover and soft tints, a pale red page
background `#fdecea`, red-tinted surfaces and borders, a red Q mark (`--brand-mark-end`), and a
dark-scheme set of dark red surfaces with light text. Every look token is given a red-family value
that keeps its role and its contrast. The header is not a solid red bar: the shared theme draws it
with `--surface`, `--text`, and `--text-muted`, so it takes the red-tinted surface like the cards,
with the red Q mark and red active link; a solid bar would need selector rules, which `red.css`
does not hold. `danger` and the scheduling-conflict banner stay told apart from the red
accent by their icon, border, and text (parity S9), not by hue alone. The header and the tab title
say "QueuePass Admin (Rust)".

The shared theme's drift scan (spec 012, `packages/shared/test/theme/`) reads the three React
apps only, and its rule C1 forbids an app defining tokens, which is exactly what `red.css` does; the
Rust app stays out of that scan under Principle VII's exception, and two `core` tests guard it
instead (R9): every look token the shared theme's app blocks define is redefined in `red.css`, in
light and dark, and no data token is, so no shared accent leaks into the Rust app and no meaning
changes; and every text-on-surface and control pair passes AA (4.5:1 text, 3:1 controls and focus)
with `red.css`'s values over the shared theme's.

The sign-in screen: unchanged from the first version. The Keycloak theme gives each client a body
class `qp-app--<clientId>` and an accent per app (spec 021, 027). Add `qp-app--admin-rust-app` with
a red accent token set and a `qpAudience.admin-rust-app` message ("For QueuePass staff, Rust
version"). These tokens live in the shared theme's sign-in token block with their contrast tests,
as Principle VII requires for sign-in accents.

**Rationale**: FR-009 to FR-011 and FR-020. Using the stylesheets themselves makes the two layouts
the same by construction, and a later change to the React app's layout reaches the Rust app with
no work. Overriding only color tokens is possible because the shared theme's drift check already
forbids raw colors outside its token blocks, so every color on a screen comes from a token. Red on
every screen is the quickest "which app am I in" signal, and the header text backs it up for people
who can't tell red apart.

**Alternatives considered**:
- *Copy the two stylesheets into the Rust app and recolor them*: The copies drift as soon as the
  React app changes, and FR-020 would need a second check to catch it.
- *Its own stylesheet and layout (the first version)*: Replaced by FR-020.
- *A red banner only*: It is easy to miss, and John asked for a red background or color across the
  app.

## R9. Tests and coverage

**Decision**:
- The crate is split into a `core` library that compiles natively and in WebAssembly, and a thin
  `app` layer of Leptos views and browser glue (`web-sys` saving, the router, the signal wiring,
  the OIDC redirect glue, pointer and wheel events). `core` holds the API client, the sign-in
  state machine and a `PkceStore` trait for the redirect values, the form checks, time logic,
  money, the row builders and the three file writers, the parity messages, the red theme's token
  values, the map and layout geometry, pan and zoom math, the seat-stream state (R13), and the
  layout editor's reducer and its helpers (R14).
- `core` is tested with `cargo test` natively. `wiremock` stands in for the Backend in API client
  tests, and fixed signing keys serve the token-handling tests. An in-memory `PkceStore` proves the
  verifier and `state` are removed after the exchange. A theme test parses `packages/shared/src/web/theme.css` and `style/red.css` and
  checks every text and control pair for AA contrast in light and dark, as the shared theme's
  contrast tests do.
- Coverage: `cargo llvm-cov --package admin-rust-core --fail-under-lines 80 --json --summary-only`,
  converted by `admin-rust-app/scripts/coverage-summary.mjs` into
  `admin-rust-app/coverage/coverage-summary.json` in the istanbul shape
  (`total.lines.{total,covered,pct}`) that `scripts/coverage-report.mjs` already reads.
  `admin-rust-app` joins that script's `WORKSPACES` and its `--clean`, with
  `scripts/test/coverage-report.test.mjs` updated first.
- The `app` layer is browser-only code. It is excluded from the floor, with its reason recorded in
  `admin-rust-app/package.json`'s `coverage` notes. It is covered by browser tests: every `@admin`
  journey runs in the `admin-rust` project (R10). Spec 037's own journeys drive the screens those
  don't reach (the event page's tier, sales, and seating cards, the Layouts card's import, section
  lines, rename, and delete, the event form's off-sale tool, the layout editor's panels, keyboard
  path, and refusals, pictures, attendee table contents, report figures, the export menu and
  downloads), and `037 SL` (R15) opens every route in both apps. Every Rust screen is
  then exercised by some browser test, which is the replacement control the amendment names.
- No `wasm-bindgen-test`. What it would have covered (redirect values cleaned up, downloads) is
  covered by the `PkceStore` unit test and by the 037 browser tests, which read `sessionStorage`
  after sign-in and check each download.
- Lint: `cargo clippy --workspace --all-targets -- -D warnings` for `core`, and
  `cargo clippy -p admin-rust-app --target wasm32-unknown-unknown -- -D warnings` for `app`.
  Format: `cargo fmt --check`.

**Rationale**: Leptos views need a DOM, and `cargo llvm-cov` measures native code. Keeping logic out
of views and measuring it natively gives a real 80% floor on everything that can break quietly.
A browser test for every screen covers what the floor can't measure.

**Alternatives considered**:
- *Measuring WebAssembly coverage in the browser*: The tooling (`minicov` and the like) is still
  experimental, and CI time would be high.
- *Rendering Leptos views to strings natively (its `ssr` feature) for tests*: This doubles the
  build configurations, and the tests would check markup, not behavior.
- *`wasm-bindgen-test` in headless Chrome*: It needs chromedriver in CI and a second test runner
  for two small checks that the other tests already make.

## R10. Browser tests against both Admin apps

**Decision**:
- `e2e/fixtures/apps.ts` gains the key `'admin-rust'` (matching `APP_REALMS`' `app`, so
  `028-app-realms.spec.ts`' `realmOf` finds it): `{ url: 'http://localhost:5176', name: 'QueuePass Admin (Rust)', role: 'admin' }`.
  Every `Record<AppName, …>` in the specs (`001-sign-in.spec.ts:28`, `027-sign-in-background.spec.ts:36`,
  and `028-app-realms.spec.ts`) gains the entry, because the root `lint` runs `tsc -p e2e`.
- An `adminApp` Playwright fixture gives the Admin app under test: `APPS.admin` by default,
  `APPS['admin-rust']` in a new project `admin-rust`. That project's `grep` matches the tag
  `@admin`. Journeys are tagged with Playwright's details object, `test('…', { tag: '@admin' }, …)`,
  not inside the title, so every existing quickstart's exact-title Automated row stays valid.
- Only journeys that use the Admin app get the tag and switch from `APPS.admin` to `adminApp`:
  001, 002, 003, 020, 024, 025, 030, 031, 035, 036, the Admin steps of 015, and (added
  2026-11-14) 038's S0, S5, S6, and S17 and 039's S1/S2/S3 and S5, whose Customer-app steps stay
  on the Customer app. (016's journey has no Admin screen.)
- `028-app-realms.spec.ts`' one-window test adds the Rust Admin app as a fourth app. Its title
  ("three apps …") changes, so 028's quickstart Automated row is edited to the new title in the
  same commit, or `check-quickstart-marks` fails.
- Spec 037's own tests live in `e2e/tests/037-rust-admin-app.spec.ts` (titles in the quickstart).
- No axe dependency. Contrast is checked by `core`'s theme test (R9). The browser test checks only
  that the red tokens are applied (computed header and page colors).
- `scripts/e2e.mjs`' `E2E_PORTS` and its test `scripts/test/e2e-ports.test.mjs` gain 5176.

**Rationale**: FR-017. One set of journeys is the parity check, run on every PR.

**Alternatives considered**: *A separate copy of the Admin specs for Rust*: Two copies would drift
apart, and the point is to prove the two apps behave the same.

## R11. Container, Compose, configuration, and the boundary check

**Decision**:
- **Build-time configuration**, as the React app gets `VITE_*` build args
  (`docker-compose.yml`, `admin-app/Dockerfile`): the Rust app reads `QP_API_BASE_URL`,
  `QP_OIDC_AUTHORITY`, and `QP_OIDC_CLIENT_ID` at compile time with `env!` in `app/src/config.rs`.
  Compose passes them as build args (`QP_API_BASE_URL: ${VITE_API_BASE_URL:-http://localhost:3000}`,
  `QP_OIDC_AUTHORITY: ${ADMIN_RUST_OIDC_AUTHORITY:-http://localhost:8080/realms/queuepass-admin-rust-app}`,
  `QP_OIDC_CLIENT_ID: admin-rust-app`), and the Dockerfile turns each `ARG` into an `ENV` before
  `trunk build`. `.env.example` gains
  `ADMIN_RUST_OIDC_AUTHORITY=http://localhost:8080/realms/queuepass-admin-rust-app`.
  `scripts/run-host.mjs` sets the same three variables for `trunk serve`.
- `admin-rust-app/Dockerfile`: the build stage uses the official `rust` image pinned to the
  toolchain version, adds the `wasm32-unknown-unknown` target, installs a prebuilt `trunk` at a
  pinned version, and copies `contracts/openapi.yaml` for `build.rs`. It builds the dependencies
  first from `Cargo.toml` and `Cargo.lock` with stub sources (a cached layer), then the app with
  `trunk build --release`. The serve stage is `nginx` with `admin-rust-app/nginx.conf`, copied from
  `admin-app/nginx.conf`'s pattern: `location = /health`, SPA fallback to `index.html`,
  `Cache-Control: no-store` on `index.html`, and listening on 5176.
- `docker-compose.yml` service `admin-rust-app`: `5176:5176`, `depends_on` `backend:
  service_healthy` and `seed: service_completed_successfully` (no sign-in page before its client
  exists), and health check `wget -qO- http://127.0.0.1:5176/health`, as `admin-app` has. No other
  service depends on it (FR-019).
- CORS: add `http://localhost:5176` to `CORS_ORIGINS` in `.env.example`, in `docker-compose.yml`
  where it is set, in `scripts/run-host.mjs`, in `backend/test/setup/test-app.ts`, and in
  `backend/test/integration/cors-docs.e2e-spec.ts`. `backend/src/configure-app.ts` already reads
  the list, so no Backend source changes.
- Seed: add `{ clientId: 'admin-rust-app', name: 'QueuePass Admin (Rust)', port: 5176 }` to the
  client list in `scripts/seed/src/provision-clients.ts`, which already derives each client's exact
  redirect URI and web origin from its port, and gives it the API audience mapper.
- Places that assume three realms, one realm per role, or 235 accounts are updated:
  `packages/shared/test/realms.test.ts` (realm count; roles equal `QUEUEPASS_ROLES` becomes "every
  row's role is in `QUEUEPASS_ROLES`"; 235 becomes 240), `scripts/seed/src/provision-users.ts`
  `EXPECTED_COUNTS` and its comments, `scripts/seed/test/clients.unit.test.ts` `PORTS`,
  and `scripts/seed/test/provision-clients.test.ts`. The `app` union in
  `backend/src/hello/hello.controller.ts` stays as it is: the Rust app calls `/hello/admin`, which
  answers any `queuepass-admin` token, so no contract change follows. The Backend's realm-driven
  auth suite (`auth.realms.e2e-spec.ts`) already loops over `APP_REALMS`.
- The red sign-in look is a full seven-role accent set (accent, hover, soft, text, brand-mark-end,
  brand-mark-text, stone-accent), in light and dark, as `check-theme.ts` requires. Tests that name
  the apps one by one gain the fourth: `packages/shared/test/contrast.test.ts`, `tokens.test.ts`,
  `drift.test.ts`, `scripts/seed/test/login-theme-files.test.ts`, and
  `e2e/tests/027-sign-in-background.spec.ts` (four line colours, not three).
- `scripts/check-boundary.mjs` also reads the Cargo manifests (`admin-rust-app/Cargo.toml`,
  `core/Cargo.toml`, `app/Cargo.toml`) and fails on any database crate (`sqlx`, `diesel`,
  `postgres`, `tokio-postgres`, `sea-orm`, `prisma-client-rust`). It scans `core/src` and `app/src`
  for database code as it scans `<app>/src` today. Principle I requires this for every front end.
- Ignores: `**/target/` joins `.dockerignore` (every image builds from the repository root, and a
  host build leaves gigabytes there), `.prettierignore`, and the ESLint `ignores`, because they
  don't read nested `.gitignore` files.

**Rationale**: Principles I and II, FR-001 and FR-019, and the same patterns the other front ends
use.

## R12. Workspace, the one test command, and CI

**Decision**:
- `admin-rust-app/` is also an npm workspace (`@queuepass/admin-rust-app`) with no npm
  dependencies, only scripts: `build` (`trunk build --release`), `test` (R9's coverage command,
  then `scripts/coverage-summary.mjs`), `lint` (R9), and `format:check` (`cargo fmt --check`).
  The root `test` script runs it after `@queuepass/admin-app`. Root `build` already runs every
  workspace's `build`, and `lint` and `format:check` call the Rust ones.
- **CI under spec 011's rules.** `scripts/test/ci-workflow.test.mjs` requires the `test` job to be
  checkout, setup-node, then named `run:` steps only, the first being `npm ci`, and every later
  step equal to a part of the root `ci` script. So the Rust setup is a part of that script, not a
  workflow step of its own: a root script `rust:setup` (`node scripts/rust-setup.mjs`) runs
  `rustup show` (which installs the toolchain `rust-toolchain.toml` pins, with its target and
  components; `rustup` is already on GitHub's `ubuntu-24.04` runners) and downloads prebuilt,
  pinned `trunk` and `cargo-llvm-cov` binaries into `~/.cargo/bin` when they are missing. It goes
  first in `ci`, after `prisma:generate`, and gets its own named step in `ci.yml`, so the test's
  step list stays equal to the script. It has its own test in `scripts/test/rust-setup.test.mjs`.
  No cache step is added, which keeps 011's shape unchanged.
- **Time budget.** Both jobs take about 10 minutes of their 30 today, and the test enforces the
  limit. The new cost is a cold instrumented `core` build, clippy on two targets, a release
  WebAssembly build, a cold Rust image in `e2e`, and every `@admin` journey run twice. T067
  records each job's time on the impl PR. If either job goes over 25 minutes, the fallback is a
  follow-up amendment of 011's rules to allow one `actions/cache` step for `~/.cargo` and
  `target/`, stated openly in that PR, not worked around.
- Developers need `rustup` on their machine for `npm test` and `npm run build`. `npm run
  rust:setup` installs the rest, and the README says so. `docker compose up --build` needs nothing
  extra, because the image brings its own toolchain.

**Rationale**: Principle VI's "one documented command" and per-workspace floor, and spec 011's CI
rules kept as they are.

## R13. Venue maps and the layout editor's map: SVG in Leptos

> **2026-11-14**: new, for the seat-map (`038`) and layout-editor (`039`) parity rows.

**Decision**: Draw every map as inline SVG from Leptos views (`view!` with the `svg` elements), with
the same elements, attributes, roles, names, and `class` values as the React components, so the
shared theme's map rules (`venue-map--<color>`, `--map-floor`, seat states, halos) style both:

- **Shared venue map** (`packages/shared/src/web/venue-map/`: `venue-map.tsx`, `section-view.tsx`,
  `sections-list.tsx`, `legend.tsx`, `layout-preview.tsx`) → `app/src/venue_map/`, used by the
  Layouts card's preview, the event form's seating section, the event page's live map, and the
  editor's phone-width preview.
- **Pure parts in `core::seating`**, ported test-first from `packages/shared/test/` and
  `admin-app/test/`: `layout-geometry.ts` (`moveBy`, `turnAbout`, `normalizeAngle`,
  `outlineAround`, `rowLabels`, `checkBlock`, `seatCounts`, `generateBlock`, `placeBlock`, and its
  constants), `map-geometry.ts` (`outlinePath`, `bounds`, `centroid`), `map-state.ts`, and the pure
  functions of `use-pan-zoom.ts` (`fitView`, `zoomOf`, `zoomAt`, `panBy`, `clientToMap`,
  `pinchView`, with `MAX_ZOOM` 40, the 1.5 step, the 0.002 wheel factor, the 4 px slop, and the
  200 ms animation), plus `LAYOUT_LIMITS` and `LEVEL_COLORS` from `packages/shared/src/seating.ts`.
  Outputs are compared with the TypeScript functions' outputs on the same fixtures (an export
  script like T065's), so a path string or a label sequence is byte-for-byte the same.
- **Browser glue in `app`**: pointer events with `setPointerCapture`, `wheel` with
  `preventDefault` (non-passive listener), two-pointer pinch, `matchMedia` for the 640 px phone
  check and `prefers-reduced-motion`, and `requestAnimationFrame` for the 200 ms zoom animation,
  through `web-sys` and `gloo`.

**Rationale**: SVG is what the React app draws, so the same CSS applies (FR-020) and the browser
tests find the same roles and names. Keeping the math in `core` puts it under the coverage floor and
lets the React tests be the reference cases.

**Alternatives considered**: *Canvas or WebGL drawing*: The shared theme's rules and the accessible
names would not apply, and 038 R13 already chose SVG. *Calling the TypeScript map from Rust through
JavaScript interop*: It would not be a Rust app (FR-003).

## R14. The layout editor's state: a pure reducer in `core::editor`

> **2026-11-14**: new, for the layout-editor (`039`) parity rows (LE1–LE81).

**Decision**: Port `admin-app/src/layout-editor/editor-state.ts` as `core::editor::reduce(state,
action) -> state`, one Rust enum variant per action (35 today), with the same messages, the same
100-document history and typing coalescing (`commit`), Undo and Redo with selection cleanup
(`travel`, `sanitize`), the id remapping after a save (`newIds`, `remapper`), `keepOnMap`, the
name and label checks, `repoint`, `planDeleteSeats`, `freeName`, and `regeneratePlan`. Port
`editor-doc.ts` (`emptyDoc`, `fromDrawing`, `toInput`, `seatLevel`, `outlineOf`, `farthest`,
`mapSize`) and `overlap.ts` (`findOverlaps`, `emptyLevels`, `warningsOf`) beside it. The pure pieces
the React app keeps inside components move into `core` too, unchanged in behavior:
`AddSectionForm`'s `CURVES`, `NEW_BLOCK`, `readDraft` and the First-row reset; `SaveBar`'s
`missingParts`, `sectionIndexOf`, and problem listing; `SelectionPanel`'s confirm texts;
`SectionSeatsView`'s `seatsInBox` and row-label ends; `EditorCanvas`'s `mapFit`, turn snapping,
handle and box placement, and floor stretch; `NumberBox`'s display rule; `LevelPicker`'s value,
"Mixed", and "Same as…" rule; `Guide`'s done flags and `hintFor`; and `LayoutEditor`'s `listed`
and title rule. Tests are ported first from `admin-app/test/layout-editor/` (`editor-state`,
`editor-doc`, `overlap`, and the component tests' cases for the moved pieces).

The `app` layer holds one Leptos signal with the state, dispatches actions from the views, and
reads `currentDoc`, `isDirty`, and `totals`. It has no editing logic of its own.

**Rationale**: The editor is about 4,300 lines of React, most of it rules that must match exactly
(messages, limits, history). A reducer ports one to one, and its tests are the React tests. The
known quirks listed in the parity checklist (for example, the Regenerate confirm text with no seats
removed) are copied, not fixed, because fixing them would make the two apps differ.

**Alternatives considered**: *Fine-grained Leptos signals per section*: Faster for huge layouts,
but the history, the id remapping, and the messages would have to be rebuilt instead of ported, and
a layout has at most 30,000 seats and 100 sections, which a reducer handles.

## R15. The unsaved-changes guard and the "same layout" check

> **2026-11-14**: new, for parity rows LE4 and the SL rows (FR-020).

**Decision**:
- **Guard.** The React app uses React Router's `useBlocker` with `window.confirm("Leave without
  saving? Your changes will be lost.")` and a `beforeunload` listener while the document is dirty
  (039 R13). `leptos_router` 0.8 has no blocker, so the Rust app adds one in `app/src/guard.rs`: a
  `dirty` signal the editor sets; the app's link component and every programmatic navigation ask
  the guard first; a `popstate` listener (Back and Forward) asks too and, if the admin cancels,
  puts the editor's URL back with `history.pushState`; `beforeunload` is set only while dirty. The
  navigations 039 leaves unguarded (opening another layout after Save as new or Duplicate to edit,
  and the move after a new layout's first save) pass the guard by a flag, as in the React app.
- **Same layout check.** The test `037 SL` in `e2e/tests/037-rust-admin-app.spec.ts` opens every
  route in both apps with the same data, at 1280 px and at 375 px wide, and compares the `main`
  element's `ariaSnapshot()` (Playwright 1.64), with the app name normalized: the same headings,
  landmarks, labels, buttons, and table columns in the same order. It also compares the bounding
  boxes of each card, form section, and table, top to bottom, within 2 px, which catches a
  missing class or wrapper that changes the arrangement. Colors are not compared.

**Rationale**: The guard must ask at the same moments as the React app (LE4). The snapshot compares
what FR-020 asks for (structure, order, and arrangement) without comparing colors, which must
differ.

**Alternatives considered**: *Screenshot comparison with colors removed*: Anti-aliasing and the
red tints make pixel diffs noisy. *A hand walk only*: The SL rows are checked by hand too (M), but
an automated check keeps the two layouts the same as the React app changes.
