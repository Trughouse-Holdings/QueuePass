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
- No role in the token: show the wrong-role page (plain message, no data, sign-out), as
  `wrong-role.tsx` does.

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

**Rationale**: Principle I. OpenAPI 3.1 schemas are JSON Schema 2020-12, which `typify` reads
directly.

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

**Rationale**: The same rules can be tested natively, without a browser. `chrono-tz` bundles the
IANA database, so results don't depend on the browser's `Intl`.

**Alternatives considered**: *`Intl` through `js-sys`*: This matches the browser exactly, but it
can only be tested in a browser and is wordy from Rust.

## R7. Downloads: CSV, XLSX, PDF in Rust

**Decision**:
- **CSV**: the `csv` crate (RFC 4180 quoting), the same columns and order as `export/csv.ts`.
- **XLSX**: `rust_xlsxwriter` with its `wasm` feature. Numbers, dates, and money are written as
  typed cells with the React app's number formats (spec 023 FR: kept as data).
- **PDF**: `printpdf`, with a small table-layout module (header row repeated on each page, column
  widths, page breaks) standing in for `jspdf-autotable`. The same title, "made at" line, columns,
  and rows.
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

## R8. The red look

**Decision**: The app has its own stylesheet, `admin-rust-app/style/theme.css`, with its own token
block on `:root`. The accent is red (`#b3261e` on white, about 6.5:1, which meets AA for text and
controls), and the page background is a pale red tint (`#fdecea`). The header bar is solid red with
white text, which says "QueuePass Admin (Rust)", as does the tab title. Dark scheme: dark red
surfaces with light text, also checked for AA. Focus rings, error, success, and sold, held, and open
seat states keep a non-color cue (text or icon), as the shared theme's do. The layout can differ
from the React app's.

The sign-in screen: the Keycloak theme already gives each client a body class `qp-app--<clientId>`
and an accent per app (spec 021, 027). Add `qp-app--admin-rust-app` with a red accent token set,
and a `qpAudience.admin-rust-app` message ("For QueuePass staff, Rust version"). These tokens live
in the shared theme's sign-in token block with their contrast tests, as Principle VII requires for
sign-in accents.

**Rationale**: FR-009 to FR-011. Red on every screen is the quickest "which app am I in" signal,
and the header text backs it up for people who can't tell red apart.

**Alternatives considered**: *A red banner only*: It is easy to miss, and John asked for a red
background or color across the app.

## R9. Tests and coverage

**Decision**:
- The crate is split into a `core` library that compiles natively and in WebAssembly (API client,
  auth state machine, form checks, time logic, money, row builders and the three file writers,
  parity messages), and a thin `ui` layer of Leptos views and the browser glue (`web-sys` saving,
  the router, the signal wiring).
- `core` is tested with `cargo test` natively, with `wiremock` standing in for the Backend in API
  client tests and fixed signing keys for the token-handling tests. Coverage is measured by
  `cargo llvm-cov` on `core` with a floor of 80% lines (`--fail-under-lines 80`), and it writes
  `lcov.info` where `scripts/coverage-report.mjs` reads every workspace's report.
- The `ui` layer is browser-only code. It is covered by the browser tests: every Admin journey in
  `e2e/` also runs against the Rust Admin app (R10). It is listed as a coverage exclusion with that
  reason. This is a change to Principle VI (today only generated code may be excluded), so the
  amendment names the replacement control: the Admin browser journeys run against this app in the
  required `e2e` check.
- A small number of `wasm-bindgen-test` tests in headless Chrome cover the browser glue that the
  browser tests can't easily reach (the download link, the `sessionStorage` cleanup after sign-in).
- `cargo fmt --check` and `cargo clippy -D warnings` join `format:check` and `lint`.

**Rationale**: Leptos views need a DOM, and `cargo llvm-cov` measures native code. Keeping logic out
of views and measuring it natively gives a real 80% floor on everything that can break quietly,
while the browser tests already exercise every screen.

**Alternatives considered**:
- *Measuring WebAssembly coverage in the browser*: The tooling (`minicov` and the like) is still
  experimental, and CI time would be high.
- *Rendering Leptos views to strings natively (its `ssr` feature) for tests*: This doubles the
  build configurations, and the tests would check markup, not behavior.

## R10. Browser tests against both Admin apps

**Decision**: `e2e/fixtures/apps.ts` gains `adminRust: { url: 'http://localhost:5176', name: 'QueuePass Admin (Rust)', role: 'admin' }`.
The Admin journeys read the Admin app from a Playwright fixture (`adminApp`) instead of
`APPS.admin` directly. A second Playwright project, `admin-rust`, sets that fixture to the Rust
Admin app and runs every spec tagged `@admin`. Specs that only check things particular to the React
Admin app's own code, if any, are left untagged with a comment. `028-app-realms.spec.ts` gains the
both-Admin-apps-at-once scenario (FR-005, SC-007). The Rust Admin app uses the same accessible
names (labels, headings, button text) as the React Admin app (spec Assumption "Look"), so the
journeys work against both unchanged.

**Rationale**: FR-017. One set of journeys is the parity check, run on every PR.

**Alternatives considered**: *A separate copy of the Admin specs for Rust*: Two copies would drift
apart, and the point is to prove the two apps behave the same.

## R11. Container, Compose, and the boundary check

**Decision**:
- `admin-rust-app/Dockerfile`: the build stage uses the official `rust` image pinned to the
  toolchain version, adds the `wasm32-unknown-unknown` target, installs `trunk` at a pinned version,
  copies `contracts/openapi.yaml` for `build.rs`, and runs `trunk build --release`. The serve stage
  is `nginx` with the React app's `nginx.conf` pattern (single-page-app fallback to `index.html`,
  and a health check), listening on 5176.
- `docker-compose.yml`: a service `admin-rust-app` on `5176:5176`, depending on Keycloak and the
  Backend being healthy, as `admin-app` does. No other service depends on it (FR-019).
- CORS: add `http://localhost:5176` to `CORS_ORIGINS` in `.env.example` and wherever
  `docker-compose.yml` sets it. `backend/src/configure-app.ts` already reads the list, so no
  Backend code changes.
- Seed: add `{ clientId: 'admin-rust-app', name: 'QueuePass Admin (Rust)', port: 5176 }` to the
  client list in `scripts/seed/src/provision-clients.ts`, which already derives each client's exact
  redirect URI and web origin from its port, and gives it the API audience mapper.
- `scripts/run-host.mjs` (running the apps on the host) starts `trunk serve --port 5176` for it.
- `scripts/check-boundary.mjs` also reads `admin-rust-app/Cargo.toml` and fails on any database
  crate (`sqlx`, `diesel`, `postgres`, `tokio-postgres`, `sea-orm`, `prisma-client-rust`), as
  Principle I requires for every front end.
- The first build of the Rust image is slow (several minutes, compiling dependencies). The
  Dockerfile caches dependencies in their own layer (`cargo-chef` style: build the dependency
  graph from `Cargo.toml` and `Cargo.lock` first) so rebuilds after code changes are quick.

**Rationale**: Principles I and II, FR-001 and FR-019.

## R12. Workspace and the one test command

**Decision**: `admin-rust-app/` is also an npm workspace (`@queuepass/admin-rust-app`) with no npm
dependencies, only scripts: `build` (`trunk build --release`), `test`
(`cargo llvm-cov --package admin-rust-core --fail-under-lines 80 --lcov --output-path coverage/lcov.info`),
`lint` (`cargo clippy --all-targets -- -D warnings`), and `format:check` (`cargo fmt --check`).
The root `test` script runs it after `@queuepass/admin-app`. CI's `test` job installs the Rust
toolchain from `rust-toolchain.toml` (with the `wasm32-unknown-unknown` target and
`llvm-tools-preview`), `cargo-llvm-cov`, and `trunk`, and caches `~/.cargo` and `target/`.

Developers need `rustup` on their machine to run `npm test` and `npm run build`, and the README
says so. `docker compose up --build` needs nothing extra, because the image brings its own
toolchain.

**Rationale**: Principle VI's "one documented command" and per-workspace floor, with no second
test command to remember.
