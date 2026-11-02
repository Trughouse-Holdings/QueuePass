# Contracts: Sign-in Background

**No API change.** `contracts/openapi.yaml` is not touched: no operation, schema, or error code is
added or changed, and the contract version does not move. The Backend is not changed.

The interface this feature changes is what a person sees behind Keycloak's sign-in pages. It is
specified in [spec.md](../spec.md) (FR-001 to FR-013) and as data in
[data-model.md](../data-model.md). `021`'s text contract (titles, headings, audience lines, body
classes, in `specs/021-sign-in-screens/contracts/README.md`) is unchanged. What each page adds:

| Reached from | Backdrop element | Lines color | Focus rings on the backdrop |
| --- | --- | --- | --- |
| Admin app | `<div class="qp-stones" aria-hidden="true">` | `--accent` (indigo) | `--stone-accent` |
| Customer app | same | `--accent-tickets` (teal) | `--stone-accent-tickets` |
| Ticket Booth app | same | `--accent-booth` (amber) | `--stone-accent-booth` |
| Account console, no client | same | `--accent` (indigo) | `--stone-accent` |
