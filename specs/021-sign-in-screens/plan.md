# Implementation Plan: Sign-in Screens

**Branch**: `021-sign-in-screens-spec` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#92](https://github.com/Trughouse-Holdings/QueuePass/issues/92)

**Input**: Feature specification from `specs/021-sign-in-screens/spec.md`

## Summary

- **A Keycloak login theme `queuepass`** (research R1), in `keycloak/themes/queuepass/login/`:
  `parent=base`, its own `template.ftl` page frame, `base`'s form templates unchanged, Keycloak's
  class hooks mapped to the shared theme's classes (R2). The realm's login theme, set by the seed
  (R7).
- **App identity per client** (R3): the heading and tab title are "Sign in to {client name}"
  (`advancedMsg(client.name)`), the audience line comes from the theme's messages keyed by client
  ID, and the accent comes from a body class `qp-app--<clientId>`. A client with no audience line
  (Keycloak's own account console) gets "Sign in to {its name}", no audience line, and the shared
  accent; no client at all gets "Sign in to QueuePass" (FR-008).
- **One shared theme** (R4, R5): `packages/shared/src/web/theme.css` gains twelve tokens, a teal set
  for the Customer app and an amber set for the Ticket Booth, in both color schemes; the Admin keeps
  the shared indigo. The Keycloak image copies the shared file into the theme at build; `login.css`
  holds the layout and one accent mapping per app. The `012` drift checker scans `login.css`, with
  one narrow exception for that mapping; the contrast test checks every new pair.
- **Keycloak gets its own Dockerfile** (R6): `keycloak/Dockerfile` from the same
  `quay.io/keycloak/keycloak:26.0`, copying the theme and the shared stylesheet;
  `docker-compose.yml` builds it. `start-dev` keeps theme caching off.
- **Seed** (R7): sets and converges the realm's `loginTheme`; renames `customer-app` to
  **QueuePass Tickets**. The Customer app's tab title and header follow (R10).
- **Constitution 3.5.0** (R8): Principle VII allows per-app name, audience line, and accent on the
  sign-in screens only. In this spec PR.
- **No API change, no database change** (contracts/README.md, data-model.md).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS for the seed and tests; FreeMarker
templates, properties files, and CSS for the Keycloak theme (Keycloak's theming format).

**Primary Dependencies**: Keycloak 26.0 (unchanged version), `@keycloak/keycloak-admin-client`
(already in the seed). No new npm package.

**Storage**: none. Keycloak realm and client settings only (data-model.md).

**Testing**: Vitest in `packages/shared` (tokens, contrast, drift over `login.css`), `scripts/seed`
(realm and client settings; theme files; live sign-in screens with Keycloak up, skipped with its
reason otherwise, as spec `011` R16), and `customer-app` (its name). Real browsers in
[quickstart.md](./quickstart.md).

**Target Platform**: the Docker Compose stack on one laptop; the sign-in pages in desktop browsers
and at phone width, in light and dark schemes.

**Project Type**: web application (one Backend, three front ends, Keycloak, a seed job).

**Performance Goals**: none beyond today: the sign-in page loads two stylesheets from Keycloak
instead of PatternFly's.

**Constraints**: Constitution V (sign-in stays on Keycloak's page; no app handles a password),
Constitution II (no manual step), Constitution VII as amended (colors only in the shared theme's
token blocks), WCAG 2.1 AA.

**Scale/Scope**: three clients, one theme, about ten files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. API-only boundary, contract first | No API change; no front end touches data differently | Pass |
| II. One command, reproducible | Theme in the image; seed converges `loginTheme`; no console step (R6, R7) | Pass |
| III. Spec-driven, reviewed | Spec + plan PR first; independent review before it opens; impl in a fresh session | Pass |
| IV. Server-authoritative rules | No domain rule involved | Pass (n/a) |
| V. Sign-in everywhere | Sign-in stays on Keycloak's page; same form, same flow, same roles (FR-011) | Pass |
| VI. Test-first, real database | Tests first for tokens, contrast, drift, seed, theme files, Customer name; live Keycloak test; quickstart walk | Pass |
| VII. One shared look | **Needs amendment**: per-app accents on sign-in screens are a per-app variant. Amended to 3.5.0 in this PR (R8); colors stay in the shared theme's token blocks and are checked | Pass after amendment |
| VIII. Staged simplicity | One theme, not three; no runtime switching; no per-app accent inside the apps | Pass |

Re-check after design: unchanged. The amendment is the only deviation and is made, not worked
around.

## Project Structure

### Documentation (this feature)

```text
specs/021-sign-in-screens/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R11
├── data-model.md        # Keycloak settings, tokens, theme files
├── quickstart.md        # S0–S9, the running-system gate
├── contracts/README.md  # no API change; the sign-in text table
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
keycloak/
├── Dockerfile                                   # NEW (R6)
└── themes/queuepass/login/
    ├── theme.properties                         # NEW (R2)
    ├── template.ftl                             # NEW (R3, R9)
    ├── messages/messages_en.properties          # NEW (R3)
    └── resources/css/login.css                  # NEW (R4)
docker-compose.yml                               # keycloak: build instead of image (R6)
packages/shared/src/web/theme.css                # twelve tokens in both blocks (R4, R5)
packages/shared/test/theme/
├── check-theme.ts                               # the login.css exception (R4)
├── drift.test.ts                                # scan login.css
├── contrast.test.ts                             # per-app accent pairs
└── tokens.test.ts                               # the twelve tokens
scripts/seed/src/
├── provision-realm.ts                           # loginTheme, create + converge (R7)
└── provision-clients.ts                         # customer-app → QueuePass Tickets (R7)
scripts/seed/test/
├── provision-realm.test.ts                      # NEW: realm settings, no Keycloak
├── provision-clients.test.ts                    # names
├── login-theme-files.test.ts                    # NEW: theme.properties and messages
├── sign-in-screens.test.ts                      # NEW: live Keycloak
└── seed-idempotence.test.ts                     # login theme on a second run
customer-app/index.html                          # <title>QueuePass Tickets</title> (R10)
customer-app/src/App.tsx                         # header brand (R10)
.specify/memory/constitution.md                  # 3.5.0, Principle VII (R8) — this spec PR
README.md                                        # version reference; 021 status row
```

**Structure Decision**: the existing monorepo. The Keycloak theme gets a top-level `keycloak/`
folder beside the services' own folders, since Keycloak is not an npm workspace; its tests live in
`scripts/seed`, the workspace that already owns Keycloak configuration.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Constitution VII amended (per-app accents on sign-in screens) | The team meeting asked for visually distinct sign-in screens; color plus name plus audience line is what makes them distinct at a glance | Name and audience line only: not "visually distinct"; leaves the issue's wrong-app problem to reading |
| A Dockerfile for Keycloak (was a plain image) | The theme must be in the container from a clean clone (Constitution II) | Bind mounts: platform-dependent nested file mount (R6) |
