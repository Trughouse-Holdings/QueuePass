# Contracts: Quickstart Browser Tests

**No API change.** `contracts/openapi.yaml` is not touched. The tests set up data through existing
operations (`createLocation`, `createEvent`, the tier operations, `createOrder`) as a signed-in user
(research R6), so the contract is what keeps them stable.

The interfaces this feature adds are for developers:

- **`npm run e2e [-- <playwright args>]`**: research R3. Exit 0 when every test passes; 1 when the
  stack's ports are in use, the stack fails to start, or any test fails.
- **The `e2e` check** in `.github/workflows/ci.yml`: research R11. Required on `main` after the
  implementation merges (R12).
- **The automation table** in every quickstart and its check in `npm test`: research R10, with
  the row formats of [data-model.md](../data-model.md) (an Automated row may end `; rest Manual:
  <what and why>` when its test walks only part of the scenario, review round 1).
