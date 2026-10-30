# Contracts: Sign-in Screens

**No API change.** `contracts/openapi.yaml` is not touched: no operation, schema, or error code is
added or changed, and the contract version does not move. The Backend is not changed.

The interface this feature changes is what a person sees on Keycloak's sign-in pages. That is
specified as text in [spec.md](../spec.md) (FR-001 to FR-008) and as data in
[data-model.md](../data-model.md); the live test in research R11 checks it:

| Reached from | `<title>` and `<h1>` | Audience line | Body class |
| --- | --- | --- | --- |
| Admin app | Sign in to QueuePass Admin | For administrators managing venues, events, and sales. | `qp-app--admin-app` |
| Customer app | Sign in to QueuePass Tickets | For customers buying and viewing tickets. | `qp-app--customer-app` |
| Ticket Booth app | Sign in to QueuePass Ticket Booth | For gate agents checking tickets in at the door. | `qp-app--booth-app` |
| Account console (no QueuePass app) | Sign in to Account Console | none | `qp-app--account-console` |
| No client | Sign in to QueuePass | none | `qp-app--` (shared accent) |
