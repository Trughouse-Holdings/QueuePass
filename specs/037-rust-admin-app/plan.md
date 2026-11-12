# Implementation Plan: Rust Admin App

**Branch**: `037-rust-admin-app-spec` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Issue**: [#163](https://github.com/Trughouse-Holdings/QueuePass/issues/163)
**Constitution**: 3.9.8 → **3.10.0** (MINOR, this PR). Contract: unchanged.

## Summary

Add `admin-rust-app/`, a second Admin app written in Rust. It is a Leptos client-side app compiled
to WebAssembly by Trunk and served by nginx on port 5176, next to the unchanged React Admin app
(5173). It signs in through its own Keycloak realm, `queuepass-admin-rust-app`, with the same admin
accounts and role. That realm is one new row of `APP_REALMS`, which the Backend, the seed, and the
browser tests already loop over. The app calls the same REST API through types generated from
`contracts/openapi.yaml`. It is red on every screen, sign-in included, and it matches the React
Admin app item by item against [the parity checklist](./contracts/parity-checklist.md). Logic lives
in a natively testable `core` crate, measured at 80% lines by `cargo llvm-cov`. Every Admin
browser journey also runs against the Rust app.

## Technical Context

**Language/Version**: Rust stable (pinned in `admin-rust-app/rust-toolchain.toml` at the current
stable when implementation starts), edition 2024, target `wasm32-unknown-unknown`. The rest of the
repository stays TypeScript on Node 22.

**Primary Dependencies**: `leptos` 0.8 (CSR) and `leptos_router`; `openidconnect` with `reqwest`
(R3); `reqwest` (API calls, works in WebAssembly and natively); `serde` and `serde_json`; `typify`
in `build.rs` (R5); `chrono` and `chrono-tz` (R6); `csv`, `rust_xlsxwriter` (`wasm` feature), and
`printpdf` (R7); `web-sys`, `wasm-bindgen`, and `gloo-timers` (browser glue). Build: `trunk`.

**Storage**: none in the app. Tokens are held in memory, and the PKCE verifier and `state` sit in
`sessionStorage` only across the sign-in redirect (R3). There is no database change.

**Testing**: `cargo test` and `cargo llvm-cov` on `core` (native), with `wiremock` for the API;
`wasm-bindgen-test` in headless Chrome for browser glue; Playwright `admin-rust` project for the
Admin journeys (R9, R10); Backend Jest tests for the new realm (contract sign-in-realm.md);
`packages/shared` and seed tests for the new realm row and client.

**Target Platform**: modern browsers (Chromium, Firefox, Safari). Served by an nginx container in
Compose.

**Project Type**: web front end (one new app in the monorepo).

**Performance Goals**: first load under 3 s on a laptop over localhost (release build, gzip). Page
changes and form feedback feel instant, as in the React app. A seat change appears within the same
time as in the React Admin app (SC-005).

**Constraints**: Principle I (API only, typed against the contract); Principle V (own realm,
tokens in memory, PKCE, exact redirect URI); no change to the React Admin app; no API change; the
Rust service failing never blocks another service (FR-019).

**Scale/Scope**: 11 screens (home, 4 venue, 5 event, attendees, reports) and 6 cards/components
with logic. The React Admin app is about 6,400 lines of TypeScript in `admin-app/src`. Expect a
similar size in Rust, and about 45 parity items.

## Constitution Check

*Gate: before Phase 0 and again after Phase 1.*

| Principle / rule | Status | How |
|---|---|---|
| I. API only, contract first | ✅ | Calls the API only. Types generated from the contract (R5). `check-boundary.mjs` extended to Cargo (R11). No contract change. |
| II. One command, reproducible | ✅ | New Compose service with a health check, gated on Keycloak and the Backend. The seed creates the realm idempotently (R4, R11). |
| III. Two PRs, reviews, citations | ✅ | This spec+plan PR (with the amendment), then `037-rust-admin-app-impl`. One independent review of each. A fresh implementer session. Commits cite `037` and `#163`. |
| IV. Server-authoritative | ✅ | The form checks are previews only, ported as-is. Backend refusals shown beside the field, values kept. |
| V. Sign-in, least privilege | ⚠️ amended | A fourth realm and client added to the rule and the Identity row. Same role, same Backend enforcement, tokens in memory, PKCE, exact URIs (R3, R4). |
| VI. Test-first, coverage | ⚠️ amended | Rust tests run by `npm test`. 80% lines floor on `core` measured by `cargo llvm-cov`. View layer excluded with the browser journeys as the named replacement control (R9). Tests written first: the Backend realm tests and `core` ports with their tests. |
| VII. One shared look | ⚠️ amended | Exception: the Rust Admin app uses its own red theme so it is clearly another version, keeping the usability targets. Its sign-in accent lives in the shared theme's sign-in token block (R8). |
| VIII. YAGNI | ✅ | No new API, no server-side Rust, no runtime theme switching, no shared Rust crate with the Customer app's Rust version until both exist. |
| Stack table | ⚠️ amended | Rust and Leptos/Trunk for this app only. Rust tests and tools added to the Front-end tests, Lint, and CI rows. |
| CORS: three origins | ⚠️ amended | Four origins. |
| Roadmap | ✅ | Row `037-rust-admin-app` reserved by this PR. The next free number is 038. |
| Shared-surface approval | ⚠️ | The constitution, `packages/shared/`, `docker-compose.yml`, `.env.example`, `.github/workflows/`, and the root `package.json` change, so every team member must approve the impl PR, and this PR for the amendment. |

**Result**: passes with the amendment in this PR (3.10.0). Every ⚠️ is a widening John asked for this
week. None weakens a control without naming its replacement: the coverage exclusion's replacement
is the required `e2e` check running every Admin journey against this app.

**Re-check after Phase 1**: unchanged. The design adds no API, no persistent data, and no service
other than the one front end.

## Project Structure

### Documentation (this feature)

```text
specs/037-rust-admin-app/
├── spec.md
├── plan.md               # this file
├── research.md           # R1–R12
├── data-model.md         # configuration rows and in-memory app types; no schema change
├── quickstart.md         # S0–S8 and the Automation table
├── contracts/
│   ├── sign-in-realm.md  # realm, client, Backend trust, CORS, Compose
│   └── parity-checklist.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source code (implementation PR)

```text
admin-rust-app/                     # new; npm workspace @queuepass/admin-rust-app (scripts only)
├── package.json                    # build / test / lint / format:check call cargo and trunk (R12)
├── Cargo.toml                      # workspace: core + app
├── Cargo.lock
├── rust-toolchain.toml             # pinned stable, wasm32-unknown-unknown, llvm-tools-preview
├── Dockerfile                      # rust+trunk build stage (dependency layer cached), nginx stage
├── nginx.conf                      # SPA fallback, port 5176
├── index.html                      # Trunk entry; <title>QueuePass Admin (Rust)</title>
├── Trunk.toml
├── style/theme.css                 # red tokens and component styles (R8)
├── core/                           # crate admin-rust-core: native + wasm, measured for coverage
│   ├── build.rs                    # typify over contracts/openapi.yaml components (R5)
│   └── src/
│       ├── api/                    # client, ApiError, one module per resource, seat stream parser
│       ├── auth/                   # AuthState machine, token timing, role check (R3)
│       ├── forms/                  # event form checks and times, venue form, section lines
│       ├── time.rs                 # venue time zone conversion, skipped/repeated times (R6)
│       ├── money.rs  format.rs
│       └── export/                 # row builders, table, made-at, file name, csv/xlsx/pdf writers
│   └── tests/                      # integration tests (wiremock), fixtures shared with export parity
└── app/                            # crate admin-rust-app: Leptos views + browser glue (wasm only)
    └── src/
        ├── main.rs  routes.rs  shell.rs
        ├── oidc_glue.rs  download.rs  seat_stream.rs
        ├── pages/                  # home, venues (list, form, detail), events (list, form, detail), attendees, reports
        └── components/             # layout card, tiers, sales, seating, seat grid, images field, export menu, notices

packages/shared/src/realms.ts       # + admin-rust row (R4); its tests
packages/shared/src/web/theme.css   # + red sign-in accent token set (R8); contrast tests
keycloak/themes/queuepass/login/    # + qp-app--admin-rust-app mapping, qpAudience message
scripts/seed/src/                   # + client row; app-realms copy
backend/test/                       # + realm trust, role, CORS tests (contract sign-in-realm.md)
scripts/check-boundary.mjs          # + Cargo dependency scan (R11)
scripts/coverage-report.mjs         # + admin-rust-app lcov
scripts/run-host.mjs                # + trunk serve on 5176
e2e/                                # adminApp fixture, admin-rust project, @admin tags, 037 tests (R10)
docker-compose.yml  .env.example  README.md  .github/workflows/ci.yml  package.json
```

**Structure decision**: one new top-level app directory, beside `admin-app/`, as every front end is.
Splitting `core` from `app` is what makes the coverage floor measurable (R9). The React Admin app's
files are not touched.

## Implementation order (for /speckit-tasks)

1. **Foundation (blocks everything)**: the realm row, seed client, Backend realm/CORS tests
   (first) and config; the Compose service with a hello page behind sign-in and sign-out, red
   shell. User Story 1 is shippable here, as a "stub front end" in the constitution's sense.
2. **`core` ports, test-first**: port each React helper with its tests: time, money, format,
   form checks, row builders. The React unit tests are the reference cases.
3. **Venues** (US2), then **Events** form and pages (US3), then **event page cards and the live seat
   map** (US4), then **Attendees, Reports, downloads** (US5).
4. **Browser tests**: the `adminApp` fixture and `admin-rust` project, tags, the 037 tests.
5. **CI, README, parity walk**, then the running-system gate from a fresh clone.

## Risks

| Risk | Mitigation |
|---|---|
| `openidconnect` in WebAssembly needs feature tweaks (`reqwest` without native TLS, random source `getrandom` `js` feature) | First task proves sign-in end to end before any screen work. Fallback: `oauth2` crate plus `openidconnect`'s ID-token verifier only. |
| `typify` can't express a contract schema | Hand-write that one type and check it against the schema (R5). |
| `printpdf` table layout effort | Built once in `core/export/pdf.rs` and shared by both reports. JS interop is the noted last resort (R7). |
| Rust image build time slows `docker compose up --build` and CI | Cached dependency layer (R11). CI caches cargo. The Rust service is off every other service's critical path. |
| Parity drift while other features land in the React Admin app | Parity is with `main` when the impl PR opens (spec Assumption). Later specs state whether they cover the Rust app. The `admin-rust` e2e project fails if a shared journey breaks. |
| Team has no Rust installed | README prerequisites. Compose needs none. |
