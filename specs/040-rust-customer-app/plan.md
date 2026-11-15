# Implementation Plan: Rust Customer App

**Branch**: `040-rust-customer-app-spec` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Issue**: [#175](https://github.com/Trughouse-Holdings/QueuePass/issues/175)
**Constitution**: 3.11.1 → **3.12.0** (MINOR: a fifth front end, a Principle V exception for one
client in another app's realm, the Rust coverage and red exceptions widened). Contract: unchanged.
**Parity target**: the React Customer app on `main` at `680b4f7` (2026-11-15).

## Summary

Add `customer-rust-app/`, a second Customer app written in Rust. Like the Rust Admin app (`037`), it
is a Leptos client-side app compiled to WebAssembly by Trunk and served by nginx, here on port 5177,
next to the unchanged React Customer app (5174). Unlike it, it has no realm of its own: it signs in
to the Customer realm `queuepass-customer-app` through its own public client `customer-rust-app`, so
customers, orders, tickets, and holds are the same in both Customer apps, and the two share one
Keycloak session (Mahdi's decision; constitution 3.12.0's Principle V exception). That client is one
row of a new `SHARED_REALM_CLIENTS` table beside `APP_REALMS` (R3), so the Backend's trust stays
exactly as it is and the seed creates no second copy of any customer. The app calls the same API
through types generated from the contract. It loads the React Customer app's own stylesheets and the
Rust Admin app's `red.css` (R6), and its sign-in page takes the Rust Admin app's red through the
login theme's per-client class (R7). Logic lives in a natively tested `core` crate, at 80% lines; the
modules it shares with the Rust Admin app are copied from it, not shared, so Nathan's app does not
change (R4). Every Customer browser journey also runs against the Rust app.

## Technical Context

**Language/Version**: Rust `1.100.0` (pinned in `customer-rust-app/rust-toolchain.toml`, the same
as `admin-rust-app/`), edition 2024, target `wasm32-unknown-unknown`. The rest stays TypeScript on
Node 22.

**Primary Dependencies**: as `037`, at the versions in `admin-rust-app/Cargo.lock`: `leptos` 0.8
(CSR), `leptos_router` 0.8, `openidconnect` 4 with `reqwest`, `reqwest` 0.12 (no TLS on wasm),
`serde`, `serde_json`, `typify` (build), `chrono`, `chrono-tz`, `web-sys`, `js-sys`,
`wasm-bindgen`, `wasm-bindgen-futures`, `getrandom` 0.2 `js` and 0.4 `wasm_js`, `base64`, `url`,
`uuid`, `libm`, `unicode-normalization`. New for the Customer app: `hmac` and `sha2` (live codes),
`qrcode` (QR matrix), `gloo-timers` (ticks and polling) (R9, R10). Not needed: `printpdf`,
`rust_xlsxwriter`, `csv` (no exports). Build: `trunk` 0.22.1.

**Storage**: none. Tokens in memory; the PKCE verifier and `state` in `sessionStorage` only across
the redirect; the entry key in memory only (parity T9). No database change.

**Testing**: `cargo test` and `cargo llvm-cov` on `core` (native) with `wiremock`; fixtures written
by small scripts that import the React app's own TypeScript (live code, QR, calendar, filters) so
outputs match byte for byte; Playwright project `customer-rust` for the `@customer` journeys, plus
040's own journeys (R13); Backend Jest tests for the new client and origin; `packages/shared`,
seed, and script tests for the new table, client, run-host child, ports, and `rust:setup` on Windows.

**Target Platform**: modern browsers, served by an nginx container in Compose. Developers on Linux,
macOS, and Windows (R14).

**Project Type**: web front end (one new app in the monorepo).

**Performance Goals**: first load under 3 s on a laptop over localhost (release build). A seat
change appears on the map within 2 s (038 S14), the Cart refreshes every second (033), the entry
code changes on each 30-second window (018).

**Constraints**: Principle I (API only, typed against the contract); Principle V as amended (own
client, shared realm, tokens in memory, PKCE, exact URIs); no change to the React Customer app or
to `admin-rust-app/`; no API change; the Rust service failing never blocks another (FR-019);
EDIS on 2026-11-20.

**Scale/Scope** (measured 2026-11-15 at `680b4f7`): 10 routes on 9 screens (event list at `/` and
`/events`, event page, venue list, venue page, My tickets, Cart, printable ticket, live entry code,
not found). `customer-app/src` is 28 files, 3,775 lines: Get tickets about 1,300
(`GetTickets.tsx` 841, `use-buy.ts` 199, `use-hold-queue.ts` 163, `OrderConfirmation.tsx`,
`HoldCountdown.tsx`), Cart 540, My tickets with calendar, print, and QR about 570, entry code about
255, lists and filters about 400. It uses about 3,200 lines of shared web code
(`packages/shared/src/web/`: sign-in about 440, galleries about 980, the venue map, its stream, and
pan and zoom about 1,780) and the shared helpers `time-zone.ts`, `holder-name.ts`, `rate-limit.ts`,
`live-code.ts`, `order.ts`, `seating.ts`, `location.ts`. 90 parity rows plus 12 "Same layout"
rows. About half of the Rust code needed (sign-in, API transport, seat stream, venue map, pan and
zoom, the page gallery, times, theme test) exists in `admin-rust-app/` and is copied (R4); the new
work is the Customer screens, the card gallery, and the hold, cart, buy, calendar, live-code, and QR
logic.

## Constitution Check

*Gate: before Phase 0 and again after Phase 1.*

| Principle / rule | Status | How |
|---|---|---|
| I. API only, contract first | ✅ | API only, types from the contract (R5); `check-boundary.mjs` scans both Rust apps (R12). No contract change. |
| II. One command, reproducible | ✅ | A Compose service with a health check, gated on the Backend and the seed. The seed converges the new client idempotently (R3). |
| III. Two PRs, reviews, citations | ✅ | This spec PR with the amendment, then `040-rust-customer-app-impl` from a fresh session. One independent review of each. Commits cite `040` and `#175`. |
| IV. Server-authoritative | ✅ | Client checks (name, quantity bounds) are previews, ported as they are; refusals shown in place, values kept. |
| V. Sign-in, least privilege | ⚠️ amended | Exception (3.12.0): the Rust Customer app's client lives in the Customer realm and shares its session; the risk is accepted explicitly for these two apps. Same role, same Backend checks (issuer, keys, audience, expiry), tokens in memory, PKCE, exact URIs (R2, R3). |
| VI. Test-first, coverage | ⚠️ amended | 80% lines on `core` by `cargo llvm-cov`; the view crate excluded with the replacement control widened to the `@customer` journeys and 040's own (R11, R13). Tests first: Backend, seed, shared table, scripts, then each `core` port. |
| VII. One shared look | ⚠️ amended | The Rust Admin app's red exception widened: the same `red.css` over the Customer app's own stylesheets; the sign-in uses the existing red sign-in tokens (R6, R7). |
| VIII. YAGNI | ✅ | No new API, realm, token, or theme. Copy instead of a shared crate now, with a follow-up issue (R4). |
| Stack table | ⚠️ amended | Rust and Leptos/Trunk for this app too; Front-end tests, Lint, and CI rows name both Rust apps. |
| CORS: four origins | ⚠️ amended | Five. |
| Roadmap | ✅ | Row `040-rust-customer-app` reserved by this PR; the next free number becomes 041. |
| CI shape (spec 011) | ✅ | `rust:setup` stays one part of the root `ci` script; no new workflow step, no cache. Times measured, with `037` R12's open fallback (R14). |
| Shared-surface approval | ⚠️ | The constitution, `packages/shared/`, `docker-compose.yml`, `.env.example`, and the root `package.json` change: every team member approves this PR and the impl PR. |

**Result**: passes with the 3.12.0 amendment in this PR. The weakened control (one realm per app)
names its accepted risk explicitly, as the amendment procedure requires; the coverage exclusion
keeps its replacement control.

**Re-check after Phase 1**: unchanged. No API, no persistent data, one front-end service.

## Project Structure

### Documentation (this feature)

```text
specs/040-rust-customer-app/
├── spec.md
├── plan.md               # this file
├── research.md           # R1–R14
├── data-model.md         # configuration rows and in-memory app types; no schema change
├── quickstart.md         # S0–S11 and the Automation table
├── contracts/
│   ├── sign-in-client.md # client, realm, Backend trust, sign-in look, CORS, Compose
│   └── parity-checklist.md
├── checklists/requirements.md
└── tasks.md
```

### Source code (implementation PR)

```text
customer-rust-app/                  # new; npm workspace @queuepass/customer-rust-app (scripts only)
├── package.json                    # dev (trunk serve --port 5177), build, test, lint, format:check
├── Cargo.toml  Cargo.lock          # workspace: core + app; lock started from admin-rust-app's (R1)
├── rust-toolchain.toml             # 1.100.0, as admin-rust-app
├── .cargo/config.toml              # getrandom wasm backend cfg (copied)
├── Dockerfile  nginx.conf          # port 5177 (R12)
├── index.html                      # <title>QueuePass Tickets (Rust)</title>; links theme.css,
│                                   #   ../customer-app/src/styles.css, ../admin-rust-app/style/red.css (R6)
├── Trunk.toml
├── scripts/coverage-summary.mjs    # copied
├── core/                           # crate customer-rust-core: native + wasm, measured
│   ├── build.rs                    # typify (copied)
│   ├── src/
│   │   ├── api/                    # client (copied transport + Customer operations), seat_stream (copied)
│   │   ├── auth/                   # copied, REQUIRED_ROLE = "customer"
│   │   ├── seating/                # copied: map_geometry, map_state, pan_zoom, venue_map
│   │   ├── hold_queue.rs  reservation.rs  buy.rs  cart.rs  availability.rs   # R10
│   │   ├── filters.rs  holder_name.rs  my_tickets.rs  calendar.rs            # R10
│   │   ├── live_code.rs  qr.rs                                               # R9
│   │   ├── gallery.rs              # rotation and size rules (from the copied gallery's pure parts)
│   │   └── time.rs  format.rs  money.rs  theme.rs
│   └── tests/                      # ported customer-app/test cases, copied 037 tests, fixtures
└── app/                            # crate customer-rust-app: Leptos views + browser glue (wasm only)
    └── src/
        ├── main.rs  config.rs  routes.rs  shell.rs  auth.rs  oidc_glue.rs  release.rs
        ├── seat_stream.rs  download.rs  device_zone.rs  util.rs              # copied glue
        ├── pages/                  # event_list, event_detail, venue_list, venue_detail, my_tickets,
        │                           #   cart, print_ticket, entry_code, not_found
        ├── components/             # event_card, event_filters, get_tickets (general, seated),
        │                           #   hold_countdown, order_confirmation, add_to_calendar, ticket_qr,
        │                           #   gallery (copied), address_link (copied), banners
        └── venue_map/              # copied: venue_map, section_view, legend, sections list, pan_zoom

packages/shared/src/realms.ts       # + SHARED_REALM_CLIENTS, realmOfApp (R3); its tests
keycloak/themes/queuepass/login/    # + a .qp-app--customer-rust-app rule (the rust set); qpAudience message (R7)
scripts/seed/src/                   # + client row; shared-realm client loop; app-realms copy
backend/test/                       # + new-client token and CORS tests (contract sign-in-client.md)
scripts/check-boundary.mjs          # both Rust apps (R12)
scripts/coverage-report.mjs         # + customer-rust-app
scripts/rust-setup.mjs              # + Windows; rustup show in both Rust apps (R14)
scripts/run-host.mjs  scripts/e2e.mjs   # + 5177
e2e/                                # customerApp fixture, customer-rust project, @customer tags, 040 tests
docker-compose.yml  .env.example  README.md  package.json  .specify/memory/constitution.md
```

**Structure decision**: one new top-level app directory, as every front end. `admin-rust-app/` and
`customer-app/` are not changed; their files are read (linked stylesheets, copied sources).

## Implementation order (for tasks.md)

1. **Shared surface and shell (blocks everything)**: the client table, seed, Backend tests,
   CORS, Keycloak look, `rust:setup` on Windows, Compose, run-host, the workspace skeleton with the
   copied sign-in, and a red shell with the header, routes, wrong role, and Log out with release.
   User Story 1 is shippable here as a stub front end.
2. **`core` ports, test-first**, in parallel streams: lists and formats; general-admission buy; holds
   and the cart; My tickets, calendar, live code, and QR.
3. **Screens**: Events and venues (US2), the event page and general admission (US4), the seated
   panel with the copied map (US3), the Cart (US3), My tickets, print, and entry code (US5).
4. **Browser tests**: the `customerApp` fixture and `customer-rust` project, tags, 040's journeys,
   `040 SL`.
5. **README, CI times, parity walk**, then the running-system gate from a fresh clone.

## Risks

| Risk | Mitigation |
|---|---|
| Five days to EDIS (2026-11-20) | About half the Rust code is copied from a working app (R4). Tasks split for four parallel sessions. Get this spec PR approved and merged first (shared-surface approval by every team member). Cut line: US1, US2, and US4 by 2026-11-18; US3 and US5 after. Apply R9's QR fallback early rather than late. |
| CI over its 30-minute limit, found late | A draft impl PR right after the stub and the tags (T032) gives real job times on day one or two; the 011 cache amendment is the prepared contingency (R14). |
| The shared session surprises a demo (signing out of one Customer app signs the other out, and releases holds made in either) | Accepted in the spec; the README and the quickstart S2 say so; 040 S2 tests it, so the behavior is known, not discovered. |
| The seed disables the new client (`legacy-realm.ts` `OTHER_CLIENTS`) | The client is not an `APP_REALMS` row (R3); a seed test asserts it stays enabled after a run from a pre-028 state. |
| QR modules differ from `qrcode-generator`'s | Port its mask scoring and compare against its own fixtures; fallback: same text, version, and level, marked in the impl PR (R9). |
| A change to the Rust Admin app's `red.css` breaks the Customer app's contrast | The Customer `core` theme test reads the linked file and fails in CI (R6). |
| CI jobs pass 25 of their 30 minutes | Times recorded on the impl PR; the open 011 fallback of `037` R12 (R14). |
| Parity drift while Customer features land in the React app | Parity is with `main` when the impl PR opens; the `customer-rust` project fails if a shared journey breaks; layout can't drift (shared stylesheets). |
| Windows host builds (`trunk`, `cargo llvm-cov`, paths) | `rust:setup` Windows cases tested first, extracting with Windows' own `tar.exe` (R14); Mahdi's machine has the pinned tools; Compose needs no host Rust. |
| Customer journeys run twice on the same accounts (attempt limits, cooldowns, orders) | The `customer-rust` project uses its own account range, `customer40`–`customer99` (R13). |
