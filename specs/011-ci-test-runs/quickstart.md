# Quickstart: Checking Test Runs on Every Pull Request

The running-system gate for `011`. Q1 runs on a laptop; Q2 to Q4 need the implementation branch
pushed and a throwaway pull request, which only a team member does (pushing and opening pull
requests is never done by a Claude session without the user's go-ahead); Q5 is done once, by a
repository admin, after the implementation PR merges.

## Q1: Reproduce a run locally (US2, FR-008)

With Docker running (the backend's tests start PostgreSQL through Testcontainers):

```bash
npm ci            # what the check installs; needed only after the lock file changes
npm run ci
```

**Expect**, in this order, each stopping the command if it fails: the Prisma client generated;
`prettier --check .` reporting every file formatted; `eslint .` with no output; every workspace
built; `npm test` running the scripts' own tests (`node --test`), the boundary check, the
contract-drift check, then each workspace's tests with a short coverage summary after each; then a
table of line coverage for all six workspaces, with any below 80% marked, ending "The 80% floor is
not enforced until 010-test-coverage is merged." Unless the Docker Compose stack is up, the seed's
two Keycloak tests show as **skipped**, after the line `[skip] Keycloak not reachable`.

Time it. Then add a blank line with trailing spaces to any `.ts` file and run `npm run ci` again.
**Expect**: it stops at the formatting check, naming that file. Undo the change.

## Q2: A green run on a pull request (US1, US3, FR-001, FR-006)

From the implementation branch, push a throwaway branch `011-ci-throwaway` with one harmless
commit (for example a comment in `booth-app/src/format.ts`) and open a **draft** pull request from
it to `main`, titled "Throwaway: CI check (do not merge)".

**Expect**: within a minute, the pull request shows the check **CI / test** running, with no one
starting it. Open it (**Details**). **Expect**: the steps, in order: Set up job, checkout, setup
Node (22, from `.nvmrc`), `npm ci`, Generate Prisma client, Check formatting, Lint, Build, Test,
Report coverage. All green. In the Test step, the backend's output shows `[test] PostgreSQL ready
with migrations applied`, so the real-database tests ran. On the run's **Summary** page, a table
lists the six workspaces' line coverage. Note the run's duration: under 15 minutes (SC-004).

## Q3: A deliberately failing run, and a superseded one (US1, US2, FR-004, FR-011, SC-002, SC-003)

On the throwaway branch, add `packages/shared/test/ci-canary.test.ts`:

```ts
import { it, expect } from 'vitest';

it('fails on purpose to prove the check goes red', () => {
  expect(1).toBe(2);
});
```

Commit and push. **Expect**: the check turns red at the **Test** step. Its output names
`ci-canary.test.ts` and the failed assertion, and the pull request's **Files changed** tab shows an
annotation on that test. No coverage table appears (the run stopped at Test). Run `npm run ci`
locally on the same commit. **Expect**: it fails at the same step, naming the same test (SC-003).

Push two more commits within a few seconds of each other (for example, edit the test's title
twice). **Expect**: the run for the first of them is shown as **cancelled**, and only the latest
commit's run finishes.

Now delete the canary test and, in the same commit, break formatting in one file (as in Q1).
**Expect**: red at **Check formatting**, naming the file. Run `npm run format`, commit, push.
**Expect**: green again.

**Reading a failure** (SC-006): the failed step's name says which check failed.

| Failed step | What it means | Fix |
|---|---|---|
| Check formatting | Prettier lists each unformatted file | `npm run format` |
| Lint | ESLint lists file, line, and rule | Fix the code |
| Build | `tsc` lists file, line, and type error | Fix the types |
| Test | The failing test, its file, and its assertion; a contract-drift failure says to run `npm run generate:api` | Fix the code or the test, never skip it (Green gate) |
| Test, with "could not pull image" or "Could not find a working container runtime" in the backend's output | The runner could not get the PostgreSQL image; not the code | **Re-run failed jobs** on the run's page |
| Report coverage | A workspace's coverage was not measured; the message names it | Check that workspace's test configuration |
| `npm ci` | `package.json` and `package-lock.json` disagree | Run `npm install` and commit the lock file |

Close the throwaway pull request without merging and delete the branch.

## Q4: The check on `main` (FR-002)

After the implementation PR merges, open the repository's **Actions** tab. **Expect**: a **CI**
run for the merge commit on `main`, green, not cancelled by any later merge.

## Q5: Make the check required on `main` (US4, FR-015)

A repository admin does this once, after Q4 shows a green run on `main`, with the team's agreement
(it changes how every pull request merges):

1. On GitHub, open the repository's **Settings → Rules → Rulesets → New ruleset → New branch
   ruleset**.
2. Name it `main: CI must pass`. Set **Enforcement status** to **Active**. Leave the bypass list
   empty.
3. Under **Target branches**, **Add target → Include default branch** (`main`).
4. Under **Rules**, tick **Require status checks to pass**, then **Add checks**, type `test`, and
   choose the `test` check from GitHub Actions. Leave **Require branches to be up to date before
   merging** off: the run on `main` (Q4) checks each merge result, and requiring it would force a
   re-run after every other merge.
5. Keep any rule the repository already has, such as requiring a pull request before merging.
   **Create**.

(With classic branch protection instead: **Settings → Branches → Add branch protection rule** for
`main`, tick **Require status checks to pass before merging**, search for `test`, select it, and
save.)

**Expect**: on the next pull request, the merge button stays disabled until **CI / test** is
green. Check it by opening a throwaway pull request with the canary test from Q3: merging is
blocked; remove the test and it is allowed. Close it without merging.

If the job is ever renamed, the required check must be updated here too, or every pull request will
wait for a check that no longer exists. The test in `scripts/test/ci-workflow.test.mjs` pins the
name for this reason.

## Q6: The running system is unchanged

The feature changes no service, but the running-system gate applies to every implementation PR:

```bash
docker compose up --build -d
```

**Expect**: every service healthy and the seed succeeding on the first run. Sign in to, use, and
sign out of the Admin app (http://localhost:5173, `admin1` / `test123`), the Customer app
(http://localhost:5174, `customer1` / `test123`), and the Ticket Booth app (http://localhost:5175,
`agent1` / `test123`). With the stack up, `npm test --workspace @queuepass/seed` runs the two
Keycloak tests instead of skipping them, and they pass.
