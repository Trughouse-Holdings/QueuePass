# Implementation Plan: Rust Admin App

**Branch**: `037-rust-admin-app-spec` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Issue**: [#163](https://github.com/Trughouse-Holdings/QueuePass/issues/163)
**Constitution**: 3.10.0 → **3.11.0** (MINOR, the first spec PR; written as 3.9.8 → 3.10.0 and renumbered on 2026-11-14 after spec 038 took 3.10.0), then **3.11.1** (PATCH, the 2026-11-14 amendment: the Admin app's layout). Contract: unchanged.

**Amended 2026-11-14** (spec Clarifications, before any implementation): the Rust Admin app is
exactly like the React Admin app on `main` at `ff993c4`, seat maps (`038`) and the layout editor
(`039`) included, with the same layout (FR-020). Constitution **3.11.1** (PATCH): Principle VII's
exception reads "its own red colors on the Admin app's layout", and roadmap row 037 depends on
`038` and `039` too. Research R8 is rewritten; R13–R15 are new; the parity checklist gains seat
maps, the layout editor, and "Same layout" rows.

## Summary

Add `admin-rust-app/`, a second Admin app written in Rust. It is a Leptos client-side app compiled
to WebAssembly by Trunk and served by nginx on port 5176, next to the unchanged React Admin app
(5173). It signs in through its own Keycloak realm, `queuepass-admin-rust-app`, with the same admin
accounts and role. That realm is one new row of `APP_REALMS`, which the Backend, the seed, and the
browser tests already loop over. The app calls the same REST API through types generated from
`contracts/openapi.yaml`. It is red on every screen, sign-in included, and it matches the React
Admin app item by item against [the parity checklist](./contracts/parity-checklist.md), with the
same layout: it uses the React Admin app's own stylesheets with a red color-token set loaded last
(R8), and its views use the same element structure and classes. Logic lives
in a natively testable `core` crate, measured at 80% lines by `cargo llvm-cov`. Every Admin
browser journey also runs against the Rust app.

## Technical Context

**Language/Version**: Rust stable (pinned in `admin-rust-app/rust-toolchain.toml` at the current
stable when implementation starts), edition 2024, target `wasm32-unknown-unknown`. The rest of the
repository stays TypeScript on Node 22.

**Primary Dependencies**: `leptos` 0.8 (CSR) and `leptos_router`; `openidconnect` with `reqwest`
(R3); `reqwest` (API calls, works in WebAssembly and natively); `serde` and `serde_json`; `typify`
in `build.rs` (R5); `chrono` and `chrono-tz` (R6); `csv`, `rust_xlsxwriter` (`wasm` feature), and
`printpdf`, pinned (R7); `web-sys`, `js-sys`, `wasm-bindgen`, and `gloo-timers` (browser glue,
pointer and wheel events for the maps and the editor, R13);
`getrandom` with its WebAssembly backend (R3). Build: `trunk`.

**Storage**: none in the app. Tokens are held in memory, and the PKCE verifier and `state` sit in
`sessionStorage` only across the sign-in redirect (R3). There is no database change.

**Testing**: `cargo test` and `cargo llvm-cov` on `core` (native), with `wiremock` for the API and
an istanbul-shaped summary for `scripts/coverage-report.mjs`; Playwright `admin-rust` project for
the `@admin` journeys, plus 037's own journeys for every screen they don't reach (R9, R10); Backend Jest tests for the new realm (contract sign-in-realm.md);
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

**Scale/Scope** (re-measured 2026-11-14 at `ff993c4`): 13 routes on 10 screens (home, venue list,
venue form for new and edit, venue page, event list, event form for new and edit, event page,
attendees, reports, and the layout editor for new, edit, and view) and about 15 cards and components with logic (the
Layouts card, section lines, the seating section and off-sale tool, tiers, sales, the live venue
map, images, the export menu, and the editor's panels). The React Admin app is about 11,750 lines
of TypeScript in `admin-app/src` (the layout editor alone about 4,300), and it uses about 5,000 lines
of shared web code (`packages/shared/src/web/`, the venue map 1,400 of them) and the shared
`layout-geometry.ts`. Expect a similar size in Rust, and about 170 parity items. The layout editor
is the largest single piece.

## Constitution Check

*Gate: before Phase 0 and again after Phase 1.*

| Principle / rule | Status | How |
|---|---|---|
| I. API only, contract first | ✅ | Calls the API only. Types generated from the contract (R5). `check-boundary.mjs` extended to Cargo (R11). No contract change. |
| II. One command, reproducible | ✅ | New Compose service with a health check, gated on Keycloak and the Backend. The seed creates the realm idempotently (R4, R11). |
| III. Two PRs, reviews, citations | ✅ | This spec+plan PR (with the amendment), then `037-rust-admin-app-impl`. One independent review of each. A fresh implementer session. Commits cite `037` and `#163`. |
| IV. Server-authoritative | ✅ | The form checks are previews only, ported as-is. Backend refusals shown beside the field, values kept. |
| V. Sign-in, least privilege | ⚠️ amended | A fourth realm and client added to the rule and the Identity row. Same role, same Backend enforcement, tokens in memory, PKCE, exact URIs (R3, R4). |
| VI. Test-first, coverage | ⚠️ amended | Rust tests run by `npm test`. 80% lines floor on `core` measured by `cargo llvm-cov`. View layer excluded; the named replacement control is a browser test for every Rust screen: the `@admin` journeys plus 037's S1–S5, S10, and SL journeys (R9, R15). Tests written first: the Backend realm tests and `core` ports with their tests. |
| VII. One shared look | ⚠️ amended | Exception: the Rust Admin app uses its own red colors so it is clearly another version, keeping the usability targets. Its layout is the Admin app's, from the same stylesheets (R8, 3.11.1). Its sign-in accent lives in the shared theme's sign-in token block (R8). |
| VIII. YAGNI | ✅ | No new API, no server-side Rust, no runtime theme switching, no shared Rust crate with the Customer app's Rust version until both exist. |
| Stack table | ⚠️ amended | Rust and Leptos/Trunk for this app only. Rust tests and tools added to the Front-end tests, Lint, and CI rows. |
| CORS: three origins | ⚠️ amended | Four origins. |
| Roadmap | ✅ | Row `037-rust-admin-app` reserved by this PR; 3.11.1 adds `038` and `039` to its dependencies. The next free number is 040. |
| CI shape (spec 011) | ✅ | Rust setup is a part of the root `ci` script (`rust:setup`), so `ci-workflow.test.mjs`' rules hold. No cache step. Job times measured, with an open fallback (R12). |
| Shared-surface approval | ⚠️ | The constitution, `packages/shared/`, `docker-compose.yml`, `.env.example`, `.github/workflows/`, and the root `package.json` change, so every team member must approve the impl PR, and this PR for the amendment. |

**Result**: passes with the amendments in the 037 spec PRs (3.11.0, then 3.11.1). Every ⚠️ is a widening John asked for this
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
├── research.md           # R1–R15
├── data-model.md         # configuration rows and in-memory app types; no schema change
├── quickstart.md         # S0–S11 and the Automation table
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
├── index.html                      # Trunk entry; <title>QueuePass Admin (Rust)</title>; links the
│                                   #   shared theme.css, admin-app/src/styles.css, then red.css (R8)
├── Trunk.toml
├── style/red.css                   # red color tokens only, light and dark; no layout rules (R8)
├── .cargo/config.toml              # getrandom wasm backend cfg (R3)
├── scripts/coverage-summary.mjs    # llvm-cov JSON → coverage/coverage-summary.json (istanbul shape, R9)
├── core/                           # crate admin-rust-core: native + wasm, measured for coverage
│   ├── build.rs                    # typify over contracts/openapi.yaml components (R5)
│   ├── src/
│   │   ├── api/                    # client, ApiError, one module per resource, seat stream parser
│   │   ├── auth/                   # AuthState machine, PkceStore trait, token timing, role check (R3)
│   │   ├── forms/                  # event form checks and times, venue form, section lines, images,
│   │   │                           #   seating section and off-sale ranges
│   │   ├── seating/                # layout geometry, venue map geometry and state, pan and zoom math,
│   │   │                           #   seat stream state (R13)
│   │   ├── editor/                 # layout editor document, state and its actions, undo and redo,
│   │   │                           #   overlap, generator, labels (R14)
│   │   ├── time.rs                 # venue time zone conversion, skipped/repeated times (R6)
│   │   ├── money.rs  format.rs  theme.rs
│   │   └── export/                 # row builders, table, made-at, file name, csv/xlsx/pdf writers
│   └── tests/                      # integration tests (wiremock), export fixtures and React expectations
└── app/                            # crate admin-rust-app: Leptos views + browser glue (wasm only)
    └── src/
        ├── main.rs  config.rs  routes.rs  shell.rs  guard.rs (R15)
        ├── oidc_glue.rs  download.rs  seat_stream.rs  device_zone.rs
        ├── pages/                  # home, venues (list, form, detail), events (list, form, detail), attendees, reports
        ├── layout_editor/          # editor page, canvas (SVG), panels; uses guard.rs (R14, R15)
        ├── venue_map/              # the shared venue map, section view, sections list, legend, preview (R13)
        └── components/             # layouts card, section lines, seating section, tiers, sales, event seat map,
                                    #   images field, export menu, notices

packages/shared/src/realms.ts       # + admin-rust row (R4); its tests
packages/shared/src/web/theme.css   # + red sign-in accent token set (R8); contrast tests
keycloak/themes/queuepass/login/    # + qp-app--admin-rust-app mapping, qpAudience message
scripts/seed/src/                   # + client row; app-realms copy
backend/test/                       # + realm trust, role, CORS tests (contract sign-in-realm.md)
scripts/check-boundary.mjs          # + Cargo manifests and Rust sources (R11)
scripts/coverage-report.mjs         # + admin-rust-app in WORKSPACES and --clean (R9)
scripts/rust-setup.mjs              # new: rust:setup, part of the root ci script (R12)
scripts/run-host.mjs                # + trunk serve on 5176 with QP_* config and CORS
scripts/e2e.mjs                     # + 5176 in E2E_PORTS
e2e/                                # adminApp fixture, admin-rust project, @admin tags, 037 tests (R10)
docker-compose.yml  .env.example  README.md  .github/workflows/ci.yml  package.json
.dockerignore  .prettierignore  eslint.config.mjs   # + **/target/
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
3. **Venues** and the Layouts card (US2), then **Events** form and pages with the seating section
   (US3), then **event page cards and the live venue map** (US4), then **Attendees, Reports,
   downloads** (US5), then the **layout editor** (US6). The venue map and layout geometry in `core`
   come before US2's preview, because every map screen uses them.
4. **Browser tests**: the `adminApp` fixture and `admin-rust` project, tags, the 037 tests.
5. **CI, README, parity walk**, then the running-system gate from a fresh clone.

## Risks

| Risk | Mitigation |
|---|---|
| `openidconnect` in WebAssembly needs feature tweaks (`reqwest` without native TLS, random source `getrandom` `js` feature) | First task proves sign-in end to end before any screen work. Fallback: `oauth2` crate plus `openidconnect`'s ID-token verifier only. |
| `typify` can't express a contract schema | Hand-write that one type and check it against the schema (R5). |
| `printpdf` table layout effort | Built once in `core/export/pdf.rs` and shared by both reports. JS interop is the noted last resort (R7). |
| Rust image build time slows `docker compose up --build` and CI (30-minute job limit) | Cached dependency layer in the image (R11). Job times measured on the impl PR; over 25 minutes triggers the open 011 amendment for a cargo cache (R12). The Rust service is off every other service's critical path. |
| `typify` and the contract's 267 `$ref`s | Spike in T021 before any screen work (R5). |
| Parity drift while other features land in the React Admin app | Parity is with `main` when the impl PR opens (spec Assumption); the checklist is complete for `ff993c4`. Later specs state whether they cover the Rust app. The `admin-rust` e2e project fails if a shared journey breaks. Layout cannot drift: the stylesheets are shared (R8). |
| The layout editor's size (about 4,300 lines of React) and its pointer handling (drag, turn, box select, pan and zoom on SVG) | The editor's state, actions, undo and redo, and geometry are pure functions in `core`, ported test-first from `admin-app/test/layout-editor/` (R14). The view layer only maps pointer events to actions. It is the last story, so P1 work never waits on it. 039's own journeys run in the `admin-rust` project. |
| A class name or element nesting differs, so a shared rule misses and the layout differs | "Same layout" rows in the checklist per screen (SL1 and on); a browser test compares each screen's headings, landmarks, and control order in both apps at desktop and phone width (R15). |
| Team has no Rust installed | README prerequisites. Compose needs none. |
