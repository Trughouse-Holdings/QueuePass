# Quickstart: A Separate Sign-in for Each App

Every scenario uses **one ordinary browser window** (one profile, no private window) unless it says
otherwise. Test accounts and the seed password are in the README.

## S0. Two starting points

- **Clean**: a fresh clone, `docker compose up --build`. The seed log shows the three app realms
  created and `admin: 5, agent: 30, customer: 200` users added.
- **Upgraded** (US3): a stack made **before** this feature, with demo data and at least one order
  for `customer1` and one check-in by `agent1`. Note `customer1`'s ticket codes and the event's
  "checked in" count. Update to this version and run `docker compose up --build` again. The seed log
  shows 235 users moved and realm `queuepass` turned off.

## S1. Three apps, three users, one window (US1; FR-001 to FR-003, SC-001, SC-003)

Walk S1 and S2 in **Chrome and in Safari** (the issue's Done when; Keycloak's cookies on
`http://localhost` are `Secure; SameSite=None`, which Safari treats differently from Chrome).

1. Open the Admin app (http://localhost:5173) and sign in as `admin1`.
2. In a new tab, open the Customer app (http://localhost:5174). **Expected**: its own sign-in page
   ("Sign in to QueuePass Tickets"), not "Your account can't use this app". Sign in as `customer1`.
3. In a new tab, open the Ticket Booth app (http://localhost:5175). **Expected**: its own sign-in
   page. Sign in as `agent1`.
4. Use all three for 15 minutes: open events in Admin, browse and open My tickets in Customer, pick
   an event in the Booth. **Expected**: no app is signed out or shows another user, at any point
   (the access token renews about every 4 minutes).
5. Reload each tab. **Expected**: each comes back as its own user.

## S2. Logging out of one app (US2; FR-004, SC-002)

1. With S1's three apps signed in, click **Log out** in the Customer app. **Expected**: the Customer
   app shows its sign-in page; the Admin and Booth tabs stay signed in.
2. Sign in to the Customer app as `customer2`. **Expected**: My tickets is `customer2`'s.
3. Wait 5 minutes, using Admin and Booth. **Expected**: both still signed in as `admin1` and
   `agent1`.
4. Repeat with the Admin app logging out, then the Ticket Booth app (SC-002's three combinations).
5. After a logout, press the browser's back button. **Expected**: no signed-in page of that app.

## S3. Existing accounts and data carried over (US3; FR-006, FR-007, SC-004)

On the **upgraded** stack from S0:

1. Sign in to the Customer app as `customer1`. **Expected**: My tickets shows the same ticket codes
   as before the update.
2. Sign in to the Admin app as `admin1`. **Expected**: the event's sales, attendees and "checked in"
   count are the same as before.
3. Sign in to the Ticket Booth app as `agent1`. **Expected**: signs in; the event list is as before.
4. Open http://localhost:8080/admin (Keycloak admin console, `admin`/`admin`): realm `queuepass` is
   still listed and is **disabled**; the three app realms each hold only their own users.
5. Run the seed again (`docker compose up --build` or `npm run seed`). **Expected**: the log says
   everything is already present; nothing changes.

## S4. Wrong realm, wrong role (US4; FR-010, FR-011, SC-005)

Covered by Backend integration tests (see Automation). By hand: the Customer app's sign-in page
refuses `admin1` ("Invalid username or password"), because `admin1` is not in the Customer app's
realm (FR-012); the same for `customer1` at the Admin app and `admin1` at the Ticket Booth.

## S5. Same app in two tabs (Edge Cases)

1. Open the Admin app in two tabs as `admin1`. Log out in one. **Expected**: the other shows the
   Admin sign-in page at its next renewal or API call; the Customer and Booth apps, if open, are
   unaffected.

## S6. Sign-in pages unchanged (FR-008)

Each app's sign-in page looks as after `027`: QUEUEPASS header, the card, the app's name and accent,
the stones with pulsing lines. `027`'s browser tests pass against the new realms.

## S7. Sign in, use, sign out (Constitution VI)

Each front end passes the smoke test from a fresh clone: sign in, one action, sign out.

## Automation

| Scenario | Automated | How |
|---|---|---|
| S0 clean | Yes | CI's stack start; seed tests (clean run) |
| S0/S3 upgraded | Partly | Seed tests: a run over a shared realm moves every user with the same subject and turns it off; a second run changes nothing; a clash is left alone; a stopped run finishes. The by-hand walk on a real pre-028 database is recorded in tasks |
| S1 | Yes (Chromium) | `e2e/tests/028-app-realms.spec.ts`: one browser context, three users; each app calls the API after the others sign in; each app's own renewal fires under Playwright's clock (`page.clock`, R10) and the app stays its user. Safari by hand |
| S2 | Yes | Same spec: each app logs out in turn; the other two still call the API and renew |
| S3 by hand | No | Needs a database made before the feature; walked once by hand |
| S4 | Yes | Backend integration tests: each realm's token on each role's endpoints; another realm's issuer with this realm's key; the old realm; an unknown issuer. `001` V4 (rewritten): each app's sign-in page refuses another app's account |
| S5 | No | Same-app behaviour is unchanged from today |
| S6 | Yes | `027`'s e2e tests on the new realms |
| S7 | Yes | Existing quickstart e2e tests (`022`), with `001` V4 rewritten for FR-012 |
