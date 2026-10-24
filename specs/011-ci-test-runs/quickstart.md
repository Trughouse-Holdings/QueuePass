# Quickstart: Checking Test Runs on Every Pull Request

The running-system gate for `011`. Q1 runs on a laptop. Q2 is the implementation PR's own check.
Q3 and Q5 use **one** throwaway pull request, which a team member opens with the user's go-ahead
(a Claude session never pushes, opens pull requests, or changes repository settings without it).
Q4 and Q5 happen right after the implementation PR merges; Q5 needs a repository admin.

## Q1: Reproduce a run locally (US2, FR-008)

With Docker running (the backend's tests start PostgreSQL through Testcontainers) and the Docker
Compose stack **down** (with it up, the seed's four Keycloak tests run instead of being skipped,
the one expected difference from the check):

```bash
npm ci            # what the check installs; needed only after the lock file changes
npm run ci
```

To reproduce a pull request's run, first merge or rebase the branch onto the latest `main`: the
check runs on the branch merged with `main`, not on the branch alone.

**Expect**, in this order, each stopping the command if it fails: the Prisma client generated;
`prettier --check .` reporting every file formatted; `eslint .` with no output; every workspace
built; `npm test` deleting old coverage output, running the scripts' own tests (`node --test`), the
boundary check, the contract-drift check, then each workspace's tests with a short coverage summary
after each; then a table of line coverage for all six workspaces, with any below 80% marked, ending
"The 80% floor is not enforced until 010-test-coverage is merged." The seed's four Keycloak tests
show as **skipped**, after the line `[skip] Keycloak not reachable`.

Time it. Then, one at a time, undoing each before the next:

- add a line with trailing spaces to any `.ts` file. **Expect**: it stops at the formatting check,
  naming that file;
- add `const unused = 1;` inside a function in `booth-app/src/format.ts`. **Expect**: it stops at
  lint, naming the file, line, and `@typescript-eslint/no-unused-vars`;
- add `const n: number = 'x';` (and use `n`) in the same file. **Expect**: it stops at the build,
  naming the file, line, and the type error.

## Q2: A green run: the implementation PR's own check (US1, US3, FR-001, FR-006)

When the implementation PR is opened, open its check **CI / test** (**Details**). **Expect**: it
started with no one starting it; the steps, in order: Set up job, checkout, setup Node (22, from
`.nvmrc`), Install dependencies, Generate Prisma client, Check formatting, Lint, Build, Test, Report
coverage, all green. In the Test step, the backend's output shows `[test] PostgreSQL ready with
migrations applied`, so the real-database tests ran. On the run's **Summary** page, a table lists
the six workspaces' line coverage. Note the run's duration: under 15 minutes (SC-004).

## Q3: A deliberately failing run, and a superseded one (US1, US2, FR-004, FR-011, SC-002, SC-003, SC-006)

Use one throwaway pull request for Q3 and Q5, and nothing else:

- branch `011-ci-throwaway`, cut from the implementation branch;
- title "Throwaway for #23 CI verification (do not merge)", body "Throwaway for #23 CI
  verification; will be closed unmerged.";
- opened as a **draft** to `main`, with **no reviewers** requested;
- linked from issue #23 in a comment, so teammates know what it is.

On the branch, add `packages/shared/test/ci-canary.test.ts`:

```ts
import { it, expect } from 'vitest';

it('fails on purpose to prove the check goes red', () => {
  expect(1).toBe(2);
});
```

Commit (record this commit's SHA: Q5 reuses it), push, and open the pull request. **Expect**: the
check turns red at the **Test** step. Its output names `ci-canary.test.ts` and the failed assertion, and the pull request's **Files changed**
tab shows an annotation on that test. No coverage table appears (the run stopped at Test). Time how
long it takes, from opening the failed check, to name the failing step and test: under 2 minutes
(SC-006). Run `npm run ci` locally on the same code (Q1). **Expect**: it fails at the same step,
naming the same test (SC-003).

Push two more commits within a few seconds of each other (for example, edit the test's title
twice). **Expect**: the run for the first of them is shown as **cancelled**, and only the latest
commit's run finishes.

Now break formatting in one file as in Q1, commit, and push. **Expect**: red at **Check
formatting**, naming the file. Revert that commit and push. **Expect**: red at **Test** again (the
canary is still there). Leave the pull request open, as a draft, with the canary, for Q5.

**Reading a failure** (SC-006): open **Details** on the failed check; the failed step's name says
which check failed.

| Failed step | What it means | Fix |
|---|---|---|
| Check formatting | Prettier lists each unformatted file | `npm run format` |
| Lint | ESLint lists file, line, and rule | Fix the code |
| Build | `tsc` lists file, line, and type error | Fix the types |
| Test | The failing test, its file, and its assertion; a contract-drift failure says to run `npm run generate:api` | Fix the code or the test, never skip it (Green gate). If it passes locally, merge or rebase onto `main` and run `npm run ci` again |
| Test, with "could not pull image" or "Could not find a working container runtime" in the backend's output | The runner could not get the PostgreSQL image; not the code | **Re-run failed jobs** on the run's page |
| Report coverage | A workspace's coverage was not measured in this run, or counted no lines; the message names it | Check that workspace's `test` script and coverage configuration |
| Install dependencies | `package.json` and `package-lock.json` disagree | Run `npm install` and commit the lock file |

## Q4: The check on `main` (FR-002)

Right after the implementation PR merges, open the repository's **Actions** tab. **Expect**: a
**CI** run for the merge commit on `main`, green, not cancelled by any later merge.

## Q5: Make the check required on `main` (US4, FR-015)

A repository admin does this right after Q4, as the constitution's recorded deferral expects (the
CI run is merge-blocking once `011` is merged and its check is required):

1. On GitHub, open the repository's **Settings → Rules → Rulesets → New ruleset → New branch
   ruleset**.
2. Name it `main: CI must pass`. Set **Enforcement status** to **Active**. Leave the bypass list
   empty.
3. Under **Target branches**, **Add target → Include default branch** (`main`).
4. Under **Rules**, tick **Require status checks to pass**, then **Add checks**, type `test`, and
   choose the `test` check from GitHub Actions (if more than one `test` is listed, the one from the
   `CI` workflow). Leave **Require branches to be up to date before merging** off: the run on
   `main` (Q4) checks each merge result, and requiring it would force a re-run after every other
   merge.
5. Keep any rule the repository already has, such as requiring a pull request before merging.
   **Create**.

(With classic branch protection instead: **Settings → Branches → Add branch protection rule** for
`main`, tick **Require status checks to pass before merging**, search for `test`, select it, and
save.)

**Verify with the throwaway pull request from Q3**:

1. Rebuild `011-ci-throwaway` from the updated `main` with only the canary on it, using the SHA
   of the commit that added the canary (recorded in Q3), then force-push that branch only:

   ```bash
   git fetch origin
   git checkout -B 011-ci-throwaway origin/main
   git cherry-pick <canary commit SHA>
   git push --force origin 011-ci-throwaway
   ```

   The pull request now shows only the canary test, whatever happened to the implementation's
   commits in rebase or review.
2. Mark the pull request **Ready for review** (a draft cannot be merged whatever its checks, so it
   would prove nothing). Still request no reviewers.
3. **Expect**: once the check is red, the merge button is blocked by the required `test` check.
4. Delete the canary test, commit, and push. **Expect**: the check turns green and merging is
   allowed. **Do not merge.**
5. Close the pull request unmerged, delete the `011-ci-throwaway` branch, and note on #23 that
   the check is required and the throwaway is closed.

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
