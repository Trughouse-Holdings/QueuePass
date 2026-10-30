# Data Model: Sign-in Screens

**Feature**: `021-sign-in-screens` | **Spec**: [spec.md](./spec.md) | **Research**:
[research.md](./research.md)

No database change: no Prisma schema change, no migration, no Backend change. Everything this
feature stores is Keycloak configuration set by the seed, and files in the repository.

## Keycloak realm `queuepass` (set by `scripts/seed/src/provision-realm.ts`)

| Setting | Before | After | Rule |
| --- | --- | --- | --- |
| `loginTheme` | unset (Keycloak's default) | `queuepass` | Set on create; converged on every seed run (R7, FR-010) |
| `displayName` | `QueuePass` | unchanged | The no-app fallback heading (FR-008) |
| `registrationAllowed` | `false` | unchanged | FR-011 |

## Front-end clients (set by `scripts/seed/src/provision-clients.ts`)

| `clientId` | Name (FR-002) | Audience line (FR-005; theme messages) | Accent set (R5; shared theme tokens) |
| --- | --- | --- | --- |
| `admin-app` | QueuePass Admin | For administrators managing venues, events, and sales. | shared `--accent` set (indigo) |
| `customer-app` | **QueuePass Tickets** (was `QueuePass`) | For customers buying and viewing tickets. | `--accent-tickets` set (teal) |
| `booth-app` | QueuePass Ticket Booth | For gate agents checking tickets in at the door. | `--accent-booth` set (amber) |
| any other client | its name, through `advancedMsg` | none | shared set |
| no client in the page | "QueuePass" (realm display name) | none | shared set |

The name is converged on every seed run (existing behavior), so an existing `customer-app` is
renamed on the next run.

## Shared theme tokens (`packages/shared/src/web/theme.css`, both token blocks)

Twelve new tokens, six per extra app, with the same roles as the shared accent set:
`--accent-{app}`, `--accent-{app}-hover`, `--accent-{app}-soft`, `--accent-{app}-text`,
`--brand-mark-end-{app}`, `--brand-mark-text-{app}`, for `{app}` = `tickets` and `booth`. Values
in research R5. No existing token changes, and no app stylesheet uses the new ones.

## The `queuepass` login theme (`keycloak/themes/queuepass/login/`)

| File | Holds |
| --- | --- |
| `theme.properties` | `parent=base`, `import=common/keycloak`, `styles=css/theme.css css/login.css`, class mappings (R2) |
| `template.ftl` | The page frame: `<title>`, band, brand mark, the one `<h1>`, audience line, page header as `<h2>`, message regions, body class `qp-app--<clientId>` (R3, R9) |
| `login.ftl` | Keycloak 26.0.8's base `login.ftl`, word for word but for `aria-describedby="input-error"` on the two fields while the error shows (R2, R9) |
| `messages/messages_en.properties` | `qpSignInTo=Sign in to {0}`, `qpAudience.admin-app`, `qpAudience.customer-app`, `qpAudience.booth-app` |
| `resources/css/login.css` | The sign-in layout and the per-app accent mapping (R4) |
| `resources/css/theme.css` | Not in the repository: copied from the shared theme by `keycloak/Dockerfile` (R6) |
