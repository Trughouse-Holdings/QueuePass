# Research: Rust Customer App

**Feature**: `040-rust-customer-app` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

Each decision below resolves an unknown from the plan's Technical Context. "React Customer app"
means `customer-app/`, "Rust Customer app" the new `customer-rust-app/`, and "Rust Admin app"
Nathan's `admin-rust-app/` (spec `037`, merged as PR #174 at `680b4f7`). Where a decision is
`037`'s unchanged, it says so and gives only what differs; `037`'s research is the full reasoning.

## R1. App shape, framework, build: `037` R1 and R2 unchanged

**Decision**: A client-side Leptos 0.8 app compiled to WebAssembly by Trunk 0.22.1, served as
static files by nginx on port 5177, on the Rust toolchain the Rust Admin app pins (`1.100.0`,
edition 2024, `wasm32-unknown-unknown`, `llvm-tools-preview`, `rustfmt`, `clippy`). A Cargo
workspace `customer-rust-app/` with two crates: `core` (`customer-rust-core`, natively testable,
measured for coverage) and `app` (`customer-rust-app`, Leptos views and browser glue, WebAssembly
only). Dependency versions start from the Rust Admin app's `Cargo.lock` (copied, then
`cargo update -p` only for crates the Customer app adds), so both apps build the same crate versions.

**Rationale**: `037` settled the stack (R1, R2), proved it end to end, and it is in CI. The
Customer app has no need the stack can't meet. Same versions mean one set of known WebAssembly
fixes (`getrandom` backends, `reqwest` without TLS) and one toolchain on every machine.

**Alternatives considered**: Another framework (Yew, Dioxus) for variety: rejected, a second Rust
stack doubles what reviewers and the CI image must know, with five days to EDIS.

## R2. Sign-in: `037` R3, with the `customer` role and release on logout

**Decision**: The `openidconnect` flow of `037` R3 (discovery with logout metadata, code with PKCE
`S256`, scope `openid profile`, ID-token check, refresh grant, `returnTo`, back-forward-cache check,
RP-initiated logout with `id_token_hint`), with these Customer differences:

- The required role is `customer` (`037`'s `core::auth` has `REQUIRED_ROLE = "queuepass-admin"`;
  the copy sets `"customer"`).
- Client `customer-rust-app` in realm `queuepass-customer-app` (build-time `QP_OIDC_CLIENT_ID`,
  `QP_OIDC_AUTHORITY`).
- Log out first runs release on logout (parity S5, S6): `POST /me/reservations/release` with the
  token still in memory, waited at most 2,000 ms, never fatal; then clears the in-memory user; then
  the end-session redirect.
- No `/hello` home page: `/` is the event list (parity S11).

The shared session (R3) needs no code: when the other Customer app ends the realm session, this
app's next refresh is refused with an OAuth error, which already "ends the session and signs in
again" (parity S2). Until then its access token still works, because the Backend checks only the
token (constitution V). This is the accepted trade-off.

**Front-channel logout with two clients in one session.** Every front-end client has
`frontchannelLogout: true`, `rootUrl` = its origin, and `baseUrl` `/` (`desiredClient` in
`provision-clients.ts`), and none sets `frontchannel.logout.url`. With two clients in one session,
an RP-initiated logout from one could make Keycloak render its front-channel logout page with a
frame for the other. Decision: T025 and `040 S2` (T029) observe it, recording the logout's
requests and pages. **Default: accept and document.** If Keycloak only redirects back (expected:
without `frontchannel.logout.url` there is no URL to frame), nothing changes and the README says
so. If it shows a logout page or frames the other app, the seed sets `frontchannelLogout: false`
on the two Customer clients only (`customer-app`, `customer-rust-app`; no app implements a
front-channel logout endpoint, so nothing is lost), with a seed test first and a note in the impl
PR. Either way, `040 S2` asserts the observed behavior so it can't change unnoticed.

**Rationale**: Principle V and parity with `auth-provider.tsx`, `logout-button.tsx`, and
`release-on-logout.ts`.

## R3. One realm, two clients: `APP_REALMS` stays one row per realm, plus `SHARED_REALM_CLIENTS`

**Decision**: `APP_REALMS` keeps its four rows unchanged. A second, small table is added beside it
in `packages/shared/src/realms.ts`, for an app that signs in through another app's realm:

```ts
/** Spec 040 (research R3): a front end with its own client in another app's realm. It has no
 * realm, role, or users of its own: it uses that realm's, so the seed makes no extra account. */
export const SHARED_REALM_CLIENTS = [
  { app: 'customer-rust', realm: 'queuepass-customer-app', clientId: 'customer-rust-app' },
] as const satisfies readonly SharedRealmClientRow[];
```

with `SharedRealmClientRow { app: 'customer-rust'; realm: AppRealm['realm']; clientId: string }`
(`AppRealm['realm']` is the literal union of the four realms, so a wrong realm fails `tsc`)
and a helper `realmOfApp(app)` that looks in both tables. The seed's and the browser tests'
import-free copies (`scripts/seed/src/app-realms.ts`, `e2e/fixtures/realms.ts`) gain the same
table, and `packages/shared/test/realms.test.ts` checks the copies equal it, that each row's realm
is one of `APP_REALMS`' realms, that client IDs are unique across both tables, and that the account
total stays 240.

What reads which table:

| Reader | Table | Effect |
|---|---|---|
| Backend `AuthGuard`, `JwksProvider` (`backend/src/auth/`) | `APP_REALMS` only | Unchanged: trusted issuers and keys are per realm, the honoured role per realm. A Rust Customer token has the Customer realm's issuer, keys, and `customer` role, so it is trusted with no code change. |
| Seed `index.ts` | both | After the realm loop, `provisionClient(kc, row.realm, …)` for each `SHARED_REALM_CLIENTS` row. No `provisionRealm`, no `provisionUsers`: no duplicate customers. |
| Seed `legacy-realm.ts` `OTHER_CLIENTS` | `APP_REALMS` only | Unchanged, and it must stay so: it disables every *other* app's client in the Customer realm after the 028 rename. A row for `customer-rust-app` in `APP_REALMS` would put it in that list and the seed would disable the new client on every run. This is the main reason for the separate table. |
| Seed `provision-users.ts` `EXPECTED_COUNTS` | `APP_REALMS` only | Unchanged (240). |
| `scripts/seed/src/provision-clients.ts` `FRONTEND_CLIENTS` | own list | Gains `{ clientId: 'customer-rust-app', name: 'QueuePass Tickets (Rust)', port: 5177 }`. `desiredClient` derives the exact redirect URI `http://localhost:5177/`, web origin, post-logout URI, PKCE `S256`, public, no direct grants. |
| Browser tests `028-app-realms.spec.ts` | `APP_REALMS` | Its one-window test proves four apps with four users stay apart; a fifth app in the Customer realm can't be signed in as a different user, so it is not added. Because `APPS` gains `customer-rust` (R13), the test's `Record<AppName, …>` objects and its `Object.keys(APPS)` loop switch to a local `APPS_028 = ['admin', 'customer', 'booth', 'admin-rust'] as const`; its title and quickstart row stay. 040's own test covers the shared session (R13). |

**Audience**: the Backend checks issuer, signature, `aud` (`OIDC_AUDIENCE`, `queuepass-api`), and
`exp`; it does not read `azp` or the client ID (`backend/src/auth/auth.guard.ts`). The audience
comes from the realm's `queuepass-api` client scope with its `queuepass-api-audience` mapper, which
`provisionClient` adds as a default scope of every client it converges. So the new client's tokens
carry `aud: queuepass-api` with no new seed code, and the Backend test asserts it (contract
[sign-in-client.md](./contracts/sign-in-client.md)).

**Rationale**: Mahdi's decision (spec Clarifications) with the smallest change: the Backend's trust
model is per realm, and a client is configuration inside a realm, so a client-only table changes
only the seed and the tests.

**Alternatives considered**:
- *A fifth `APP_REALMS` row with the Customer realm and `count: 0`*: every reader assumes one row
  per realm (the Backend's `Map` by issuer would keep the last row; `realm-roles`, `users` and
  `provision-realm` tests loop per row; `OTHER_CLIENTS` would disable the client). Each would need
  a guard.
- *`clientIds: string[]` on each row*: changes the shape every reader and both copies use, for one
  extra client.
- *Its own realm, as `037`*: rejected by Mahdi: the accounts must be the same customers.

## R4. Code from the Rust Admin app: copy, not a shared crate

**Decision**: Copy the Rust Admin app's modules the Customer app needs into `customer-rust-app/`,
each file starting with a comment naming its source path and `680b4f7`, and change the copies as
the Customer app needs. Do not change `admin-rust-app/` at all. Link (not copy) its `style/red.css`
(R6). Record a follow-up issue, after EDIS, to extract the copied modules into one shared crate.

Copied (about 9,000 lines of Rust and 7,000 of tests, adapted):

| From `admin-rust-app/` | To `customer-rust-app/` | Change |
|---|---|---|
| `core/build.rs` (typify over the contract) | same | none |
| `core/src/api/client.rs` (`Call`, `ApiError`, `ApiClient`, error envelope) | `core/src/api/client.rs` | keep the transport and error types; replace the operation list with the Customer app's (R5) |
| `core/src/api/seat_stream.rs` (SSE parser, reconnect policy) | same | none. **New work beside it**: the `withMine` rules, which neither of the Rust Admin app's stream files has (`packages/shared/src/web/use-seat-stream.ts` lines 123–163, `GetTickets.tsx` line 330): read `GET /me/reservations` on open, again 200 ms after a change that touches one of the customer's seats or makes any seat held, keep only the latest request's answer (`mineRequest`), and ignore an answer older than the page's last hold or release (`mineAt` against `lastWrite`). In `core/src/mine.rs`, test first (tasks T046, T048) |
| `core/src/auth/mod.rs` | same | `REQUIRED_ROLE = "customer"` |
| `core/src/seating/{mod,geometry,map_geometry,map_state,pan_zoom,venue_map}.rs` | same | none expected: they already port the shared venue map's `price` mode, the legend, and the Sections list's `openPrices`; `geometry.rs` comes too because `mod.rs` and `tests/seating_geometry.rs` use it |
| `core/src/pages/event_page.rs`' gallery parts (`GALLERY_INTERVAL_MS`, `SLIDE_MS`, `gallery_box_height`, `count_line`, …) and their tests | `core/src/gallery.rs` | only what the copied `gallery.rs` view uses; the Admin event page's other parts are not copied |
| `core/src/time.rs`, `money.rs`, `format.rs` (shared parts) | same | keep what the Customer app's `format.ts` and `time-zone.ts` use; drop Admin-only helpers |
| `core/src/theme.rs` and `core/tests/theme.rs` | same | read `customer-app/src/styles.css` and `../admin-rust-app/style/red.css` (R6) |
| `core/tests/{api_client,auth_state,seat_stream,seating_geometry,venue_map,time,money}.rs` and their fixtures | same | as the code |
| `app/src/{oidc_glue,auth,config,util,download,seat_stream,device_zone}.rs` | same | release on logout (R2); no `guard.rs` (the Customer app has no unsaved-changes guard); `seat_stream.rs` gains the `withMine` wiring to `core::mine` (new work) |
| `app/src/venue_map/{venue_map,section_view,legend,pan_zoom}.rs` | same | `layout_preview.rs` not copied (the Customer app has no preview). **New work**: the Rust Admin app's `venue_map.rs` says the skip link and the Sections list's focus moves (`skipTo`, `focusSeats`) are "not ported", and it has no Sections list at all. The Customer app needs all three: the "Skip to the Sections list" button (parity M4), the Sections list (`sections-list.tsx`, M7), and focusing the first seat once a chosen section's seats are drawn (M7) |
| `app/src/components/{gallery,address_link,link,banners}.rs` | same | the copied gallery is the `page` variant only (parity E3). The `card` variant (parity B6: the link wrapper, one shared `IntersectionObserver`, the 3:4–2:1 clamp and 160 px minimum, holding only the shown and next image) is **new work**, about 200 lines of view plus its rules in `core::gallery` |
| `scripts/coverage-summary.mjs`, `Dockerfile`, `nginx.conf`, `Trunk.toml`, `rust-toolchain.toml`, `.cargo/config.toml`, `index.html` | same | port 5177, names, paths (R12) |

**Rationale**: `037` research VIII said "no shared Rust crate with the Customer app's Rust version
until both exist". Now both exist, but a shared crate today would mean changing Nathan's merged
app five days before EDIS: moving its modules, renaming `admin_rust_core::*` paths across about
30,000 lines, making its `REQUIRED_ROLE` and API list generic, and re-running its parity and CI
checks, with every change a risk to a demo that already works. The Rust Admin app's view layer is
also a binary crate, which nothing can depend on. Copying keeps `admin-rust-app/` byte-for-byte
unchanged (spec Out of scope), lets the two implementers work without blocking each other, and keeps
each app's coverage measured on its own `core`. The copied code's behavior is already the shared
React code's behavior, checked by `037`'s fixtures, which come along.

**Alternatives considered**:
- *A path dependency on `admin-rust-core`*: it hard-codes the admin role and the admin API list,
  pulls in the export writers (`printpdf`, `rust_xlsxwriter`) the Customer app never uses, and a
  change to the Rust Admin app could break the Customer app's build. Its views could not be shared
  anyway.
- *Extract a shared crate now (`rust-shared/`)*: the right end state, deferred to the follow-up
  issue because of the deadline and the risk to the Rust Admin app.

## R5. Calling the API: `037` R5, with the Customer app's operations

**Decision**: Types generated by `typify` from `contracts/openapi.yaml` in `core/build.rs` (copied,
R4), any schema `typify` can't express hand-written and checked with `jsonschema`, as `037` R5. The
client module has one function per operation the React Customer app calls, with the same paths,
methods, query keys, and bodies (parity rows name each): `GET /events` (`q`, `locationId`,
`fromDate`, `toDate`), `GET /events/{id}`, `GET /events/{id}/availability`,
`GET /events/{id}/tiers`, `GET /events/{id}/images/{imageId}` (the picture bytes, with the
token; the list comes with the event), `POST /events/{id}/orders`,
`POST /events/{id}/reservation`, `POST /events/{id}/reservation/release`, `GET /events/{id}/venue-map`,
`GET /events/{id}/venue-map/sections/{sid}`, `GET /events/{id}/seats/stream` (SSE, through the
copied stream glue with `withMine`), `GET /locations`, `GET /locations/{id}`, `GET /me/orders`,
`GET /me/reservations`, `POST /me/reservations/release`, and `GET /me/tickets/{id}/entry-key`. The
implementer confirms the list against `customer-app/src` and `packages/shared/src/web/` (T021).

**Rationale**: Principle I. The contract is unchanged.

## R6. The red look on the React Customer app's layout

**Decision**: As `037` R8, on the Customer app's stylesheets: `customer-rust-app/index.html` links,
in this order (as `customer-app/src/main.tsx` imports the first two):

1. `../packages/shared/src/web/theme.css`,
2. `../customer-app/src/styles.css`,
3. `../admin-rust-app/style/red.css` — **the Rust Admin app's own file, linked, not copied**.

`red.css` redefines exactly the 14 look tokens (`--bg`, `--surface`, `--surface-alt`, `--border`,
`--border-strong`, `--text`, `--text-muted`, `--text-faint`, `--accent`, `--accent-hover`,
`--accent-soft`, `--accent-text`, `--brand-mark-end`, `--brand-mark-text`) in light and dark, and
nothing else. `customer-app/src/styles.css` uses only those look tokens, the space, radius, and
font tokens, and `--qr-dark`/`--qr-light` (checked on `680b4f7`), so every Customer screen turns
red and the data colors (levels, map, seats, QR, danger, warn, ok) stay the shared theme's.

The Leptos views use the same element structure and `class` values as the React components, so the
same rules apply (FR-020). The Customer app has no brand mark (its brand is plain text, parity S9),
so `--brand-mark-*` has no visible effect there.

Tests: the copied `core/tests/theme.rs` checks, over `theme.css` + `customer-app/src/styles.css` +
`../admin-rust-app/style/red.css`, that `red.css` still redefines exactly the 14 look tokens and no
data token, and that every text-on-surface and control pair the Customer screens use passes AA in
light and dark. If a later change to the Rust Admin app's `red.css` broke the Customer app, this
test fails in the Customer workspace.

**Rationale**: "the same red as the Rust Admin app" is guaranteed by construction: one file. The
layout cannot drift from the React Customer app's. No copy to keep in step.

**Alternatives considered**: *Copy `red.css`*: two copies drift, and "the same red" would need a
test comparing them. *Change `red.css`'s location to a shared place*: touches Nathan's app (R4).

## R7. The red sign-in screen for one client of a shared realm

**Decision**: Keep one login theme (`queuepass`) for the realm, and pick the red by client in the
existing template, as every app's accent is already picked. `keycloak/themes/queuepass/login/template.ftl`
already sets `<body class="qp-app--${client.clientId}">` and the heading "Sign in to
{client.name}" from the client that started the sign-in (specs `021`, `027`). So:

- `keycloak/themes/queuepass/login/resources/css/login.css`: a new rule
  `.qp-app--customer-rust-app { …the same seven --*-rust mappings as .qp-app--admin-rust-app… }`
  beside the Rust Admin app's, which stays untouched. A separate rule, not a selector list: the
  theme drift check accepts only a single-class sign-in rule (`SIGN_IN_RULE` in
  `packages/shared/test/theme/check-theme.ts`; `drift.test.ts` asserts a selector list is
  reported), and that guard is not weakened. So the Rust Customer app's sign-in uses the Rust Admin app's red sign-in tokens (`--accent-rust`,
  `--accent-rust-hover`, `--accent-rust-soft`, `--accent-rust-text`, `--brand-mark-end-rust`,
  `--brand-mark-text-rust`, `--stone-accent-rust`), light and dark. No new token, so the shared
  theme's sign-in block and its contrast tests stay as they are.
- `messages_en.properties`: `qpAudience.customer-rust-app=For customers buying and viewing tickets,
  Rust version` (the plain client ID passes the template's `[a-z0-9-]+` check).
- The client's name `QueuePass Tickets (Rust)` (seed, R3) gives the heading and tab title "Sign in
  to QueuePass Tickets (Rust)".
- `customer-app` keeps `.qp-app--customer-app` (teal), so the React Customer app's sign-in screen is
  byte-for-byte unchanged.

Keycloak 26 also supports a per-client login theme (the client attribute `login_theme`, "Login
theme" under the client's Login settings), which overrides the realm's theme for sign-ins that
client starts. It is not needed here, because the template already knows the client.

What the shared session means for the red page: it shows whenever Keycloak shows a form for the
Rust Customer app (no session yet, or after sign-out). When a session already exists from the React
Customer app, Keycloak skips the form for both clients, so there is no sign-in page to color; the
app itself is red from its first screen.

**Rationale**: FR-010 with no new theme, no change to `keycloak/Dockerfile` (only `login.css` and
the messages file, which the image already copies, change), and no change to any other app's
sign-in screen. Constitution VII's rule that sign-in accents are tokens in the shared theme's
sign-in block, checked by its contrast tests, is met by reusing the existing red set.

**Alternatives considered**:
- *A second theme `queuepass-rust` set as the new client's `login_theme`*: a copy of the templates,
  messages, scripts, and stones image to keep in step, a second theme directory in
  `keycloak/Dockerfile`, and every theme test twice, for the same result.
- *Red tokens of its own for the Rust Customer app*: Mahdi asked for the Rust Admin app's red.

## R8. Times, formats, money

**Decision**: As `037` R6 and R7's money rules: `chrono` and `chrono-tz` in `core`, ported
test-first from `customer-app/test/format.test.ts`, `times.tz.test.tsx`, `doors-open.test.tsx`,
`started-notice.test.tsx`, and the `packages/shared/test/` cases for `time-zone.ts`
(`formatEventTime`, `formatEventEnd`, `formatDoorsOpen`, `formatViewerTime`). The viewer's own zone
(only the `SEAT_COOLDOWN` message, parity F4) is read once in `app` with
`js_sys::Intl::DateTimeFormat` (copied `device_zone.rs`) and passed into `core`. Money from the
decimal strings, never a float (parity F1, F2); counts with `en-US` grouping (F5).

## R9. Live entry codes and QR codes

**Decision**:
- **Live code** (parity T11): `core::live_code` ports `packages/shared/src/live-code.ts` with the
  `hmac` and `sha2` crates (pure Rust, the same HMAC-SHA256) and an RFC 4648 base32 encoder without
  padding, and `live-code-clock.ts`'s offset rule with an injected monotonic clock
  (`performance.now()` from `web-sys` in `app`). Tests port `packages/shared/test/live-code*.test.ts`
  and `customer-app/test/entry-code.test.tsx`'s cases, plus fixtures written by a small script that
  imports the TypeScript functions unchanged (as `037`'s T031 and T065 do), so the Rust output is
  byte-for-byte the React app's for the same key, ticket, and window (SC-007). Reference cases:
  `packages/shared/test/live-code.test.ts`.
- **No Web Crypto needed**: the React app shows "Can't show the live code in this browser…" when
  `crypto.subtle` is missing (parity T10). The Rust app computes the HMAC itself, so that state
  can't happen. Its text is kept in `core` for completeness, and the row is marked N/A in the impl
  PR with this reason. Every other entry-code state is the same.
- **QR** (parity T12): the React app draws `qrcode-generator` 2.0.4's matrix (type 0 = smallest
  version, level M, alphanumeric mode, the mask with the lowest penalty as that library scores it).
  The Rust app builds the matrix with the `qrcode` crate without its segment optimiser
  (`QrCode::with_error_correction_level` may mix numeric and alphanumeric segments, which
  `qrcode-generator` never does): one alphanumeric segment through `qrcode::bits::Bits`
  (`push_alphanumeric_data`, then the terminator for level M), at the smallest version that fits at
  level M (as `qrcode-generator`'s type 0 picks it), with the mask chosen by a port of
  `qrcode-generator`'s `getLostPoint` (about 80 lines) applied through the crate's canvas API; then
  it draws the same SVG (`viewBox` with a 4-module quiet zone, one
  `path.ticket-qr__dark` of `M{c+4} {r+4}h1v1h-1z` per dark module). Fixtures from
  `qrcode-generator` itself, for the printed code and for live codes, are the reference: same
  modules.
- **Fallback (accepted by Mahdi, spec Clarifications)**: if the same modules can't be reached in
  the time left, the QR stays a valid code of the same text at the same version and level, which
  every scanner and the Ticket Booth read the same; the impl PR marks T12 "same text, not same
  modules" with the reason. The gate reads the text, not the picture. The exact mask match is a
  goal, not a gate: apply the fallback first if the first try doesn't match.

**Rationale**: FR-015 and SC-007. Keeping both pieces in `core` puts them under the coverage floor.

## R10. Seat holds, the cart, and the general-admission purchase as pure state machines

**Decision**: Port the React Customer app's stateful hooks as pure reducers in `core`, with every
time read from an injected clock, as `037` R14 did for the layout editor:

- `core::hold_queue` from `use-hold-queue.ts` (parity M10): one request at a time, click order,
  cancel a queued unsent action, queue the opposite of an in-flight one, drop on refusal, drop
  queued holds on a 429, clear on 401.
- `core::reservation` from `GetTickets.tsx`' seated part and `HoldCountdown.tsx` (M9, M11–M13,
  M15): `seatView`, the deadline from `secondsLeft` and a 201 or new `createdAt`, the 250 ms tick,
  the 1-minute warning once per reservation, run out at 0, the hold log (5 lines, cleared 10 s
  after the last), and every refusal text.
- `core::buy` from `use-buy.ts` (P7–P10, C6): the request id rules, Check again, the unknown
  outcome, the 429 waits (`useWaits`, `limitedFor`, BUY and HOLD apart) and their countdown.
- `core::cart` from `Cart.tsx` (C1–C10): entries per event and `createdAt`, the deadline fixed at
  first sight, the 1-second read schedule (read now, every 1,000 ms while visible, on `visibilitychange`
  and `focus`, one at a time, stop on 401), the event-detail retries (1, 2, 4, 8, then 10 s; after 3
  failures "Details unavailable"), run out, and the vanished-entry rule with its one `/me/orders`
  read.
- `core::availability` from `GetTickets.tsx`' general part (P1–P6, E5–E7): the closed badge and
  text, the started note, the limit line and box, quantity bounds, totals in cents.
- `core::filters` from `filters.ts` (B3, B4), `core::holder_name` from
  `packages/shared/src/holder-name.ts` (P5), `core::calendar` from `calendar.ts` (T5–T7, the ICS
  text with folding at 75 octets, the file name, the Google link), and `core::my_tickets` from
  `MyTickets.tsx` (T1–T4: upcoming and Past by the load time, ticket state text, which links show).

`app` holds the Leptos signals, timers (`gloo-timers`), `visibilitychange`, `focus`, and `online`
listeners, and the fetches, and only feeds events to these reducers.

Tests are ported first from `customer-app/test/` (`seat-hold-click`, `seat-holds`, `seats`,
`cart`, `purchase`, `purchase-unavailable`, `rate-limit`, `ticket-limit`, `holder-name-field`,
`started-notice`, `doors-open`, `past-events`, `my-tickets`, `check-ins-removed`, `calendar`,
`add-to-calendar`, `filters`, `entry-code`, `print-ticket`, `venue-map-flow`, `sections-list`,
`seat-stream`, `format`, `times.tz`): each case that checks logic becomes a `core` test; each that
checks markup becomes a browser assertion or an SL row.

**Rationale**: These are the behaviors most likely to differ quietly (timings, order of requests,
messages). As reducers they are testable natively, count toward the floor, and the React tests are
their reference cases.

**Alternatives considered**: *Leptos signals and effects holding the logic directly*: shorter, but
untestable outside a browser, and the floor would not see it.

## R11. Tests and coverage: `037` R9

**Decision**: `cargo llvm-cov --package customer-rust-core --fail-under-lines 80 --json
--summary-only`, converted by the copied `scripts/coverage-summary.mjs` into
`customer-rust-app/coverage/coverage-summary.json`; `customer-rust-app` joins
`scripts/coverage-report.mjs`' `WORKSPACES` and `--clean`, and the root `test` script after
`@queuepass/customer-app`. The `app` crate is excluded, with the reason in its `package.json`
`coverage` note. The replacement control is the constitution's, widened (Principle VI): every
`@customer` journey runs against the Rust Customer app in the required `e2e` check, and spec 040's
own journeys drive the screens they don't reach (R13). Lint: both clippy commands of `037` R9 for
this workspace; `cargo fmt --check`.

## R12. Container, Compose, host run, CORS, boundary, ignores

**Decision**, following `037` R11 with these values:

- `customer-rust-app/Dockerfile`: `037`'s, with `customer-rust-app` paths, the build-time
  `QP_API_BASE_URL`, `QP_OIDC_AUTHORITY` (default
  `http://localhost:8080/realms/queuepass-customer-app`), and `QP_OIDC_CLIENT_ID`
  (`customer-rust-app`); it copies `contracts/openapi.yaml`, `packages/shared/src/web/theme.css`,
  `customer-app/src/styles.css`, and `admin-rust-app/style/red.css` at their repository paths
  (R6); no PDF fonts. `nginx.conf`: `customer-app/nginx.conf`'s rules, listening on 5177 (parity
  S14).
- `docker-compose.yml` service `customer-rust-app`: build args
  `QP_API_BASE_URL: ${VITE_API_BASE_URL:-http://localhost:3000}`,
  `QP_OIDC_AUTHORITY: ${VITE_CUSTOMER_OIDC_AUTHORITY:-http://localhost:8080/realms/queuepass-customer-app}`
  (the React Customer app's variable: the same realm, so no new `.env` key),
  `QP_OIDC_CLIENT_ID: customer-rust-app`; `5177:5177`; `depends_on` `backend: service_healthy` and
  `seed: service_completed_successfully`; health check `wget -qO- http://127.0.0.1:5177/health`;
  nothing depends on it (FR-019).
- CORS: `http://localhost:5177` added wherever 5176 is listed: `.env.example`, `docker-compose.yml`,
  `scripts/run-host.mjs`, `backend/test/setup/test-app.ts`,
  `backend/test/integration/cors-docs.e2e-spec.ts`. No Backend source change.
- `scripts/run-host.mjs`: a sixth child, `npm run dev --workspace @queuepass/customer-rust-app`
  (`trunk serve --port 5177`) with the three `QP_*` values for the Customer realm and
  `customer-rust-app`, and its line in the start banner ("Customer (Rust) http://localhost:5177",
  "Ctrl+C stops all six"). `scripts/e2e.mjs` `E2E_PORTS` gains 5177.
- `scripts/check-boundary.mjs`: its one `RUST_APP` constant becomes a list of both Rust apps, so
  the Customer app's manifests and sources are scanned for database crates and code the same way.
- `**/target/` is already in `.dockerignore`, `.prettierignore`, and the ESLint ignores (`037`).

## R13. Browser tests against both Customer apps

**Decision**:
- `e2e/fixtures/apps.ts` gains `'customer-rust': { url: 'http://localhost:5177', name: 'QueuePass
  Tickets (Rust)', role: 'customer' }`; every `Record<AppName, …>` gains the entry
  (`001-sign-in.spec.ts`, `027-sign-in-background.spec.ts`, `028-app-realms.spec.ts`), so
  `tsc -p e2e` passes, except `028-app-realms.spec.ts`, which narrows its records and loop to its
  own four apps (R3 table).
- **Accounts**: customer state is per account (attempt allowances keyed by `sub`, cooldowns,
  orders, the cart), and the `customer-rust` project re-runs every `@customer` journey after the
  `chromium` project. So `customerFor` takes the project into account: `customer100`–`customer159`
  as today in `chromium`, and a disjoint range, `customer40`–`customer99` (20 per worker slot,
  used by no test on `680b4f7`), in `customer-rust`. A run in one project never meets another's
  leftover limits, holds, or orders.
- A `customerApp` fixture (`e2e/fixtures/customer-app.ts`, as `admin-app.ts`): `'customer'` by
  default, `'customer-rust'` in a new Playwright project `customer-rust` with `grep: /@customer/`.
- Tag with the details object, never in the title, and switch the Customer steps to `customerApp`:
  `001 V3` and `001 V4` (their per-app loops take `customerApp` in place of the hard-coded
  `'customer'`, and `expectSignedIn` gains a `customer-rust` branch), `006 P1/P4`, `007 S3`, `015`
  (its Customer steps), `016 S2`, `017 S3` (its Customer steps), `019 S2`, `020 S6`, `025`'s
  Customer journey, `026 S2`, `030 S1/S2` and its second journey, `033 S1/S2/S6`, `034 S1/S2`,
  `038 S10/S12/S13`, `038 S10/S15`, `038 S14`, `038 S16`, `038 S17` (its Customer steps), the
  Customer steps of `037`'s journeys that hold or buy in the Customer app (`037 S4`), and the
  Customer steps of `003`, `029 S2`, `036`, and the other `038` and `039` journeys that open the
  Customer app. A journey
  that uses both an Admin app and the Customer app carries both tags and runs in both Rust
  projects, each switching only its own app. `028`'s one-window test stays untagged (it needs four
  separate users; the shared session is 040's own test).
- `027-sign-in-background.spec.ts`: a fifth app whose audience line is `qpAudience.customer-rust-app`
  and whose line colour equals the Rust Admin app's (five apps, four distinct colours).
- Spec 040's own tests (titles in the quickstart), one file per implementer session so parallel
  work never edits one file: `e2e/tests/040-rust-customer-app.spec.ts` (`040 S1` the red sign-in
  and the same account, `040 S2` the shared session and its sign-out, `040 S8` the wrong-role and
  unreachable screens), `040-seats-cart.spec.ts` (`040 S5` holds and the cart across the two apps),
  `040-tickets.spec.ts` (`040 S6` entry code, print, and calendar file equal in both apps), and
  `040-same-layout.spec.ts` (`040 S11`, every route's `main` `ariaSnapshot()` and boxes in both
  apps at 1280 and 375 px, `037` R15's method). A title with an apostrophe is written in double
  quotes.
- `040 S8` reaches the two screens no `@customer` journey reaches, with **no Keycloak writes** (a
  role-less user in the Customer realm would be disabled by the seed's `disableOldCopies` on every
  run, `scripts/seed/src/legacy-realm.ts`): it signs in as a test customer while `page.route`
  rewrites the token endpoint's answer, replacing the access token's payload with one whose
  `realm_access.roles` lacks `customer` (the signature is left as is). Both apps read roles from
  the access token's claims without verifying it, before any API call (React `auth-provider.tsx`
  `claimsOf`; Rust `core::auth::claims_of`, copied), and the ID token, which the Rust app does
  verify, is untouched. It expects the wrong-role card with no API call made. Then it routes the
  page's API calls to a network failure (`page.route(…, (r) => r.abort())`) and expects "Can't
  reach the QueuePass service.".
- No other Playwright change: the workers and the per-project account ranges above keep parallel
  tests apart.

**Rationale**: FR-017. One set of journeys is the parity check.

## R14. `rust:setup` on Windows, both Rust apps, and the CI time budget

**Decision**:
- `scripts/rust-setup.mjs` runs `rustup show` in both `admin-rust-app/` and `customer-rust-app/`
  (the same pinned toolchain, so the second is instant), then installs the pinned `trunk` and
  `cargo-llvm-cov` once.
- Windows support: `TRIPLES` gains `'win32-x64': 'x86_64-pc-windows-msvc'` (and
  `'win32-arm64': 'aarch64-pc-windows-msvc'`). On Windows the release assets are `.zip`
  (`trunk-x86_64-pc-windows-msvc.zip`, `cargo-llvm-cov-x86_64-pc-windows-msvc.zip`, and the
  `aarch64-pc-windows-msvc` ones, all published for `v0.22.1` and `v0.9.1`, checked 2026-11-15),
  and the binaries are `trunk.exe` and `cargo-llvm-cov.exe`. So `assetUrl(tool, triple)` picks
  `.zip` for a `windows-msvc` triple; `install` downloads it to a temporary file and extracts the
  one `.exe` with Windows' own bsdtar by its full path, `%SystemRoot%/System32/tar.exe -xf <file>
  -C <bin> <name>.exe` (from Git Bash the `tar` first on `PATH` is GNU tar, which can't read zip);
  `version()` runs `cargo.exe` and `trunk.exe`.
  Linux and macOS stay as they are. `scripts/test/rust-setup.test.mjs` gains the Windows cases first
  (triple, URL, file name, version command).
- Mahdi's machine already has Rust 1.100.0, `trunk` 0.22.1, and `cargo-llvm-cov` 0.9.1 in
  `~/.cargo/bin`, so `npm run rust:setup` there should install nothing; that is its first check.
- **CI time**: on `main` at `680b4f7` the `test` job took about 15 minutes and `e2e` about 14, of 30
  each (037's impl run: about 14 and 13.5). Estimate with 040: `test` about 21–23 minutes and
  `e2e` about 20–25 minutes, so the 25-minute trigger below is a real risk, and opening the draft
  impl PR early is the control. This feature adds a second cold instrumented Rust build and clippy run to `test`, and a
  second Rust image plus every `@customer` journey again to `e2e`. The impl PR records both jobs'
  times **early**: a draft impl PR is opened as soon as the stub app and the `@customer` tags are in
  (tasks T032), so real times are known on day one or two, not on the last day. Over 25 minutes,
  the follow-up is `037` R12's: an amendment of spec 011's rules to allow
  one `actions/cache` step for `~/.cargo` and the two `target/` folders, stated openly, never worked
  around.

**Rationale**: Mahdi develops on Windows, and the root `ci` script runs `rust:setup` first.
