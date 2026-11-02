# Data Model: Sign-in Background

**Feature**: `027-sign-in-background` | **Spec**: [spec.md](./spec.md) | **Research**:
[research.md](./research.md)

No database change: no Prisma schema change, no migration, no Backend change, and no Keycloak
setting change (the realm's login theme is already `queuepass`, `021`). Everything this feature adds
is files in the repository.

## Shared theme tokens (`packages/shared/src/web/theme.css`, both token blocks, same values)

| Token | Value | Use (research) |
| --- | --- | --- |
| `--stone-base` | `#3a3a3a` | Page color under the stones; the fallback (R4, FR-009) |
| `--stone-scrim` | `rgb(0 0 0 / 60%)` | The shade behind the header and the card (R5) |
| `--stone-text` | `#ffffff` | The realm header on the backdrop |
| `--stone-accent` | `#8b85f5` | The lines (Admin, and pages with no app) |
| `--stone-accent-tickets` | `#2dd4bf` | The lines (Customer app) |
| `--stone-accent-booth` | `#fbbf24` | The lines (Ticket Booth app) |

Six tokens (`--stone-text-muted` and `--stone-danger` were removed when the card came back: that text
is on the card, in the shared colors; R6).

No existing token changes. No app stylesheet uses them (FR-012, checked by the drift test).

## Per-app mapping (`login.css`, the `021` exception plus one role)

| Body class | Six `021` roles | Seventh role |
| --- | --- | --- |
| `qp-app--admin-app`, any other | shared set (unchanged) | `--stone-accent` (shared) |
| `qp-app--customer-app` | `--accent-tickets` set | `--stone-accent: var(--stone-accent-tickets)` |
| `qp-app--booth-app` | `--accent-booth` set | `--stone-accent: var(--stone-accent-booth)` |

The lines are filled with `var(--stone-accent)`, so they follow the app through the seventh role
and are the same in both schemes (FR-003, FR-007).

## The `queuepass` login theme (`keycloak/themes/queuepass/`)

| File | Change |
| --- | --- |
| `login/template.ftl` | `<div class="qp-stones" aria-hidden="true"></div>` first in `<body>`; in `main`, the realm header `<div class="qp-realm" aria-hidden="true">` and the card `<div class="card qp-card">` holding `021`'s frame and the form (R4, R7) |
| `login/resources/css/login.css` | The three layers, the shade, the realm header, Keycloak's card in the shared theme with the app's accent as its top edge, every input's focus ring, the seventh role (R4–R7) |
| `login/resources/img/stone-lines.png` | **New**: the lines image (below) |
| `NOTICE` | **New**: the lines image's source (with its SHA-256), copyright, license, and change (R3) |
| `LICENSE-keycloak.txt` | **New**: the Apache License 2.0 text, as Keycloak ships it (R3) |
| `login/theme.properties`, `login/login.ftl`, `login/messages/messages_en.properties` | Unchanged |

## The lines image (`stone-lines.png`)

| Property | Value |
| --- | --- |
| Size | 1920×1080, the same as Keycloak's `keycloak-bg.png` |
| Format | 8-bit grey and alpha PNG; grey 255 wherever alpha is above 0 |
| Alpha | 160 of 255 (about 63%, Mahdi's choice from the T010 previews) on the edges between facets whose greys differ by at least `MIN_STEP` (1), 2 px wide, with a 1 px softened edge at half that (80); clear elsewhere |
| Text chunk | One, `Source`: the input (`keycloak-bg.png`, Keycloak 26.0.8, SHA-256 `0825175291be11f7689e8718295e422bb6fa4f8fefccc5610292b720c701ac4e`) and the generator settings. The license is in `NOTICE` and `LICENSE-keycloak.txt`, not in the PNG |
| Made by | `npm run stone-lines --workspace @queuepass/seed -- <keycloak-bg.png>`; `--check` confirms the committed file has the same decoded pixels and text chunk as a fresh run (bytes may differ between machines) |

## Keycloak's stones image (not in the repository)

| Property | Value |
| --- | --- |
| In the image | `/opt/keycloak/lib/lib/main/org.keycloak.keycloak-themes-26.0.8.jar`, `theme/keycloak/login/resources/img/keycloak-bg.png` |
| Served at | `/resources/{version}/login/keycloak/img/keycloak-bg.png`; from `login.css`, `../../keycloak/img/keycloak-bg.png` |
| Facts the tests rely on | 1920×1080, grey only, lightest `#898989`, darkest `#000000`, SHA-256 above (R2) |
