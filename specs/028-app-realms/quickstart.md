# Quickstart: A Separate Sign-in for Each App

Every scenario uses **one ordinary browser window** (one profile, no private window) unless it says
otherwise. Test accounts and the seed password are in the README.

## S0. Two starting points

- **Clean**: a fresh clone, `docker compose up --build`. The seed log shows the three app realms
  created and `admin: 5, agent: 30, customer: 200` users added.
- **Upgraded** (US3): a stack made **before** this feature, with demo data and at least one order
  for `customer1` and one check-in by `agent1`. Note `customer1`'s ticket codes and subject, and the
  event's "checked in" count. Update to this version and start it again. The seed log shows realm
  `queuepass` renamed to `queuepass-customer-app`, 5 admins and 30 agents created in their realms,
  and 35 old copies and 2 clients disabled in the customer realm. **Reload** any app tab left open
  from before the update (an old tab still signs in through the old realm's name, spec Edge
  Cases).

## S1. Three apps, three users, one window (US1; FR-001 to FR-003, SC-001, SC-003)

Walk S1 and S2 in **Chrome**, and in **Safari** on a Mac (the issue's Done when; Keycloak's cookies
on `http://localhost` are `Secure; SameSite=None`, which Safari treats differently from Chrome).
This laptop has no Safari: the Safari walk is Nate's or Mahdi's on a Mac running the branch, and
until then a Playwright **WebKit** run of the `028` test stands in for it (tasks T032, T033).

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
   as before the update, and `customer1`'s subject is unchanged (Keycloak admin console, Users).
2. Sign in to the Admin app as `admin1` (a new account, same username and password). **Expected**:
   the event's sales, attendees and "checked in" count are the same as before; the check-in still
   names `agent1`.
3. Sign in to the Ticket Booth app as `agent1`. **Expected**: signs in; the event list is as before.
4. Open http://localhost:8080/admin (Keycloak admin console, `admin`/`admin`): there is no realm
   `queuepass` any more; `queuepass-customer-app` holds the 200 customers (enabled) and the old
   admins and agents (**disabled**), and its `admin-app` and `booth-app` clients are disabled; the
   Admin and Booth realms hold only their own users.
5. On the Customer app's sign-in page, try `admin1` with the seed password. **Expected**: refused,
   "Account is disabled, contact your administrator." (the old copy is disabled; a wrong password
   gives "Invalid username or password").
6. Run the seed again. **Expected**: the log says everything is already present; nothing changes.

## S4. Wrong realm, wrong role (US4; FR-010, FR-011, SC-005)

Covered by Backend integration tests (see Automation). By hand, on a **clean** stack: the Customer
app's sign-in page refuses `admin1` ("Invalid username or password"), because `admin1` is not in
the Customer app's realm (FR-012); the same for `customer1` at the Admin app and `admin1` at the
Ticket Booth. (On an upgraded stack, the Customer app refuses `admin1` as a disabled account: S3.)

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

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`. The Backend's realm and role checks
(S4) and the seed's rename (S0, S3) are covered by their own workspaces' tests (tasks T006, T012 to
T015a), not by browser tests.

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: the clean start is every `npm run e2e`; the upgraded start needs a database made before 028, walked by hand (T026); the rename is covered by the seed's tests |
| S1 | Automated: `028 S1/S2: three apps signed in as three users in one browser window stay signed in through their own renewals, and logging out of one leaves the others signed in`; rest Manual: Safari and the 15-minute run by hand; the test runs against built bundles (CI's `e2e` job, or `vite build` and `vite preview`), not Vite's dev server (research R13 step 4) |
| S2 | Automated: `028 S1/S2: three apps signed in as three users in one browser window stay signed in through their own renewals, and logging out of one leaves the others signed in`; rest Manual: the back button by hand; the test runs against built bundles (CI's `e2e` job, or `vite build` and `vite preview`), not Vite's dev server (research R13 step 4) |
| S3 | Manual: needs a database made before 028 (T027, T028); the rename is covered by the seed's tests |
| S4 | Manual: the Backend's integration tests cover each realm's token and role (T006); another app's account on a sign-in page is `001` V4, rewritten in T023 |
| S5 | Manual: the same app in two tabs behaves as before 028 |
| S6 | Manual: the sign-in pages are `027`'s browser tests, which run on the new realms |
| S7 | Manual: sign in, use, and sign out of each front end, by hand; the main journeys are `022`'s browser tests |
