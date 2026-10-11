# Contracts for 012

**No contract change.** [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) is not
touched (it is **1.5.0** on `main` today; `016` may raise it first, which does not affect this
feature), and `packages/shared/src/api-schema.ts` is not regenerated. This feature changes only
how the Admin and Customer apps look; it adds, changes, and calls no API operation (spec FR-016).

The only new "interface" is inside the repository: the shared package exports the theme as
`@queuepass/shared/theme.css` (research R1), and each app imports it from `src/main.tsx`.
