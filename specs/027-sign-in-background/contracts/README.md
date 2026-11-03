# Contracts: Sign-in Background

**No API change.** `contracts/openapi.yaml` is not touched: no operation, schema, or error code is
added or changed, and the contract version does not move. The Backend is not changed.

The interface this feature changes is what a person sees behind Keycloak's sign-in pages. It is
specified in [spec.md](../spec.md) (FR-001 to FR-013) and as data in
[data-model.md](../data-model.md). `021`'s text contract (titles, headings, audience lines, body
classes, in `specs/021-sign-in-screens/contracts/README.md`) is unchanged. What each page adds:

| Reached from | Backdrop element | Lines on the backdrop (both schemes); the card's top edge and rings are the app's `--accent` |
| --- | --- | --- |
| Admin app | `<div class="qp-stones" aria-hidden="true">` | `--stone-accent` (indigo, `#8b85f5`) |
| Customer app | same | `--stone-accent-tickets` (teal, `#2dd4bf`) |
| Ticket Booth app | same | `--stone-accent-booth` (amber, `#fbbf24`) |
| Account console, no client | same | `--stone-accent` (indigo, `#8b85f5`) |
