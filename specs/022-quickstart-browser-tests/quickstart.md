# Quickstart: Quickstart Browser Tests

**Feature**: `022-quickstart-browser-tests` | **Spec**: [spec.md](./spec.md)

The running-system gate for this feature.

## B1. One command on a laptop (US4; FR-013, SC-006)

1. With your own stack up (`docker compose up -d`), run `npm run e2e`. **Expected**: it stops at once,
   naming the ports in use and how to free them; your stack keeps running, its data untouched.
2. `docker compose down` (keeps your data), then `npm run e2e`. **Expected**: a fresh `qpe2e` stack
   builds and starts, the seed and demo data load, every test passes, `e2e/playwright-report/` is
   written, and afterwards `docker ps -a --filter name=qpe2e` and `docker volume ls --filter
   name=qpe2e` list nothing.
3. `npm run e2e -- -g "015 S2"`. **Expected**: only that test runs.

## B2. Three in a row (FR-011, SC-004)

`npm run e2e -- --repeat-each=3`. **Expected**: every test passes all three times; no retries are
reported. Record the counts in tasks.md.

## B3. A broken journey turns the check red (US1; SC-001)

1. On a throwaway branch, break one wire: in `customer-app/src/pages/MyTickets.tsx` (or wherever My
   tickets calls the API), change the path to one that does not exist. Open a draft PR.
   **Expected**: `test` still passes (the component tests stub the API); `e2e` fails, naming `006 P4`
   (and any other test that opens My tickets), with a screenshot and trace in the run's artifacts.
2. Revert. **Expected**: `e2e` passes. Close the draft PR unmerged and delete its branch (as `011`'s
   #78).

## B4. The marks (US3; FR-007, FR-008, SC-005)

1. Open any three quickstarts. **Expected**: an Automation table at the end, every scenario listed.
2. Rename one test's title by one character, run `npm test`. **Expected**: the marks check fails,
   naming the test and the quickstart. Revert.

## B5. CI timing and the required check (FR-009, FR-012, SC-003)

1. On the implementation PR: the `e2e` job's duration is under 30 minutes; `test`'s is unchanged
   from `main`'s last run (within normal variation).
2. After merge, on `main`'s push run: `e2e` passes. A repository admin adds `e2e` to the ruleset.
   **Expected**: a PR whose `e2e` fails shows as blocked.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`.

| Scenario | Browser test |
| --- | --- |
| B1 | Manual: a laptop run with a teammate's own stack up, by hand |
| B2 | Manual: `npm run e2e -- --repeat-each=3`, run by hand before the implementation merges |
| B3 | Manual: a throwaway pull request on GitHub |
| B4 | Manual: a test renamed by hand to see the check fail |
| B5 | Manual: CI timing and the ruleset, on GitHub |
