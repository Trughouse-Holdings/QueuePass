# Feature Specification: A Separate Sign-in for Each App

**Feature Branch**: `028-app-realms-spec`

**Created**: 2026-11-09

**Status**: Draft

**Issue**: [#138](https://github.com/Trughouse-Holdings/QueuePass/issues/138) (signing in to one
app signs users out of the others in the same browser: session conflicts across windows)

**Input**: User description: "028" (issue #138; the roadmap number is reserved by this PR's
amendment, Constitution 3.9.0). From Nate's list for the week of Nov 8 ("Session Disconnections:
resolve session state conflicts causing unexpected logouts across multiple browser windows") and
Dr. Squyres' note that John will expect a demo of all three apps on each laptop: today that needs
three separate browser sessions per laptop so the apps "don't keep knocking each other offline".

## Context

Builds on `001` (every front end signs in on Keycloak's page with the Authorization Code flow and
PKCE, holds its tokens in memory only, renews them in the background, and logs out of both itself
and Keycloak; the Backend validates every token and enforces roles), `021` (each app's sign-in page
names the app) and `027` (the stones background and the realm-name header on every sign-in page).

Today the three apps share **one** Keycloak realm, `queuepass`, and Keycloak keeps one signed-in
user per browser for each realm. Reproduced on `main` at `276489a` (2026-11-09, research R1):

1. Admin app, signed in as `admin1`.
2. Customer app opened in a second tab of the same window: no sign-in page at all. It reuses
   `admin1` and shows "Your account can't use this app. You are signed in as admin1."
3. **Log out** there, to sign in as `customer1`: that ends `admin1`'s session for every app.
4. The Admin tab still looks signed in, until its next background renewal about 4 minutes later.
   The renewal is refused, the app signs in again, and Keycloak hands it `customer1`: the Admin
   tab now says "can't use this app, signed in as customer1".

A probe against the same Keycloak (research R2) showed this is not something the apps can work
around inside one realm: signing in as a different user, even through a fresh sign-in form, ends
the previous user's session, so only the last user signed in can renew. Keycloak keeps a separate
session cookie for each realm, so **one realm per app** gives each app its own sign-in. The user
chose this over keeping one realm and only explaining the conflict better (research R3).

## Clarifications

### Session 2026-11-09

Mahdi took the decisions marked "decided by Mahdi". Every other answer is the recommended one,
written unattended and marked **recommended answer, open to review**, so the team can overturn it in
review of this PR.

- Q: How should the apps stop knocking each other out? → A: **A separate Keycloak realm for each
  app**, so each app has its own sign-in session in the browser (decided by Mahdi, after the probe
  showed per-app tokens inside one realm cannot work) (FR-001, FR-002).
- Q: Which users live in which realm? → A: **Each realm holds only the users of its app's role**:
  the 5 admins in the Admin app's realm, the 30 gate agents in the Ticket Booth's, the 200 customers
  in the Customer app's. No account is copied into two realms, because no seeded user has two roles
  (recommended answer, open to review) (FR-005).
- Q: What happens to the accounts, orders and tickets already in a database made before this
  feature? → A: **The old shared realm is renamed to become the Customer app's realm.** Keycloak
  user identifiers are unique across the whole server, so a user cannot be copied into a second
  realm with the same identifier while the original stays (observed, research R5). Renaming keeps
  every user's identifier: the 200 customers stay where they are, and every order, ticket, seat
  hold and purchase-limit record, all tied to the customer's identifier, still belongs to the same
  customer. Admins and gate agents get **new accounts** in their own realms, with the same
  usernames and password; their old copies stay in the customer realm, **disabled, never
  deleted**. Nothing in QueuePass ties an admin or agent to their identifier except the
  `checkedInBySub` note on past check-ins, which is kept beside the agent's username, and the
  username is what every screen shows (decided by Mahdi, 2026-11-09, over copying and then
  deleting the originals, or new identifiers with a database rewrite) (FR-006, FR-007, research
  R5, R6).
- Q: Does a role only count in its own app's realm? → A: **Yes.** The Backend accepts tokens from
  the three app realms only, and from each realm honours only that app's role. A customer-realm
  token that somehow carried `queuepass-admin` is still not an admin (recommended answer, open to
  review) (FR-009, FR-010).
- Q: Two tabs of the **same** app as the same user? → A: They share that app's sign-in, as today.
  Logging out in one tab ends that app's sign-in, and its other tabs find out at their next renewal
  or API call. Only cross-app interference is in scope (recommended answer, open to review)
  (FR-004, Edge Cases).
- Q: Does each realm keep the sign-in look? → A: **Yes, unchanged.** Every realm uses the
  `queuepass` login theme, and its display name stays "QueuePass", so `027`'s header still reads
  QUEUEPASS above the card (recommended answer, open to review) (FR-008).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Three apps, three users, one browser window (Priority: P1)

A presenter opens the Admin app as `admin1`, the Customer app as `customer1` and the Ticket Booth
app as `agent1`, in three tabs of one ordinary browser window, and uses all three for as long as the
demo lasts. None of them signs another out, and each app opens on its own sign-in page.

**Why this priority**: This is the bug in #138 and the demo John will run this week. Without it,
every demo needs three separate browser sessions.

**Independent Test**: In one browser window, sign in to each app as a different user, then keep
using all three past at least two background renewals (more than 10 minutes). Every app stays signed
in as its own user throughout.

**Acceptance Scenarios**:

1. **Given** the Admin app is signed in as `admin1`, **When** the Customer app is opened in another
   tab of the same window, **Then** it shows its own sign-in page, not "Your account can't use this
   app", and signing in as `customer1` leaves the Admin app signed in as `admin1`.
2. **Given** all three apps are signed in as `admin1`, `customer1` and `agent1` in one window,
   **When** more than 10 minutes pass with each app in use (two or more renewals each), **Then**
   each app is still signed in as its own user, and each one's API calls succeed.
3. **Given** all three apps are signed in, **When** any one of them is reloaded, **Then** it comes
   back as its own user, not as a user of another app.

---

### User Story 2 - Logging out of one app leaves the others signed in (Priority: P1)

A presenter logs out of one app, for example to switch customers, and the other apps carry on.

**Why this priority**: Logging out is how the bug starts today. Without this the demo still breaks
the first time someone switches user.

**Independent Test**: With all three apps signed in in one window, log out of the Customer app and
sign in as `customer2`. The Admin and Ticket Booth apps stay signed in, through their next renewal.

**Acceptance Scenarios**:

1. **Given** all three apps are signed in in one window, **When** the Customer app logs out,
   **Then** the Customer app ends its own sign-in (its next visit shows its sign-in page), and the
   Admin and Ticket Booth apps stay signed in through their next renewal.
2. **Given** the Customer app has logged out, **When** someone signs in to it as `customer2`,
   **Then** it is `customer2`, and the other two apps are unchanged.
3. **Given** an app has logged out, **When** the browser's back button is used, **Then** no
   signed-in page of that app is shown (`001` SC-007, unchanged).

---

### User Story 3 - Existing accounts and their data carry over (Priority: P1)

Someone who already has a running QueuePass, with orders, tickets and check-ins, updates to this
version and runs the usual start command. Every account still signs in with the same username and
password, in its own app, and sees exactly the data it saw before.

**Why this priority**: The team stack and every laptop that will run the demo already hold data
and accounts. Losing them, or splitting a customer from their tickets, would break the demo.

**Independent Test**: On a database made before this feature, with orders for `customer1` and a
check-in by `agent1`, start the updated system. `customer1` signs in to the Customer app and sees
the same tickets; the Admin app shows the same orders and check-in.

**Acceptance Scenarios**:

1. **Given** a system made before this feature, **When** the updated system starts, **Then** every
   account signs in to its own app with its existing username and password.
2. **Given** `customer1` had orders before the update, **When** `customer1` signs in after it,
   **Then** My tickets shows the same tickets, with the same identifier as before, and the Admin
   app shows the same orders, attendees and check-ins (each check-in still names its agent).
3. **Given** the update has run, **When** the start command is run again, **Then** nothing changes
   (the rename runs once and is safe to repeat).

---

### User Story 4 - Each role only counts in its own app (Priority: P2)

The Backend accepts a sign-in from any of the three apps, and treats a token from one app's
sign-in as allowing only that app's work.

**Why this priority**: Separate sign-ins must not open a new way to reach admin endpoints. It keeps
`001`'s least-privilege rule true with three issuers instead of one.

**Independent Test**: Call an admin endpoint with tokens from each realm; only the Admin realm's
admin token is allowed. Call with a token from an unknown realm or issuer; it is refused as not
signed in.

**Acceptance Scenarios**:

1. **Given** a valid token from the Customer app's realm, **When** it calls an admin-only endpoint,
   **Then** the Backend refuses it with 403, even if the token lists `queuepass-admin`.
2. **Given** a token from a realm that is not one of the three app realms, including the old shared
   realm, **When** it calls any endpoint but health, **Then** the Backend refuses it with 401.
3. **Given** a valid token from each app's realm, **When** it calls an endpoint its app's role
   allows, **Then** the call succeeds, as before this feature.
4. **Given** `customer1`, **When** it tries to sign in on the Admin app's sign-in page, **Then** the
   page refuses it (unknown username or password), and no app's sign-in changes.

---

### Edge Cases

- **Two tabs of the same app as the same user**: they share that app's sign-in. Logging out in one
  ends it for both; the other finds out at its next renewal or API call and shows its sign-in page.
  Unchanged from today, and not a cross-app conflict.
- **Signing in to the same app as a different user in a second tab**: as today, the newer sign-in
  replaces the older one for that app only. The other apps are unaffected.
- **A tab still open from before the update**: it still runs the old build, which signs in through
  the old realm's name; that name no longer exists, so its next renewal is refused and it lands on
  Keycloak's "realm does not exist" page. **Reloading the tab** loads the new build, which shows its
  own app's sign-in page. Old tabs are reloaded after the update (quickstart S0, S3).
- **Keycloak restarts or is unreachable**: unchanged from `001`/`018` (renewals are retried; a
  refused renewal ends that app's sign-in only).
- **Both the old realm and a Customer app realm exist**: the seed cannot rename, so it stops with
  an error naming both realms, changes nothing, and says how to recover (rename the extra
  `queuepass` aside in Keycloak's console, for example to `queuepass-recreated`; never delete it).
  It never merges, overwrites or deletes a realm or an account, and never silently cuts customers
  off from their orders (research R6). The likely cause is **code from before this feature run
  against an upgraded Keycloak**: its seed (for example `run-host.mjs`, or the live seed test, from
  an older checkout) recreates `queuepass` with 235 new accounts. That is why an upgraded stack is
  only ever run from this feature's code onwards (research R13).
- **An account of another app** (`customer1` at the Admin app, `admin1` at the Customer app): on a
  clean system it is not in that app's realm, so the sign-in page refuses it as an unknown username
  or password. On an upgraded system, the old copies of admins and agents are in the Customer
  app's realm but disabled, so the Customer app's sign-in page refuses them as disabled accounts.
  Before this feature such an account signed in and was shown the wrong-role page; that page now
  only appears for an enabled account in the app's realm without the app's role, which the seed
  does not create (FR-012).
- **The seed is stopped half way**: the rename is one step, done or not done; everything after it
  converges on the next run (research R6).
- **A database made from a clean clone**: there is no old realm; the seed creates the three realms
  and their users directly.
- **Subject identifiers in different realms**: Keycloak makes every user identifier unique across
  the whole server (research R5), so QueuePass, which keys data by subject alone, never sees two
  users with the same one (research R7).

## Requirements *(mandatory)*

### Functional Requirements

**Separate sign-ins**

- **FR-001**: Each of the three apps MUST sign in through its own Keycloak realm, so the browser
  holds a separate sign-in for each app.
- **FR-002**: Signing in to, renewing, or logging out of one app MUST NOT end, change or replace the
  sign-in of either other app in the same browser, at that moment or at any later renewal.
- **FR-003**: Opening an app that is not signed in MUST show that app's sign-in page, whatever
  other apps are signed in in the same browser.
- **FR-004**: Logging out of an app MUST end that app's sign-in in the app and in Keycloak, as
  `001` requires, and only that app's.

**Realms, users and the rename**

- **FR-005**: The seed MUST provision the three app realms, each with its app's client, its app's
  role, and the users of that role (5 admins, 30 gate agents, 200 customers, as today), with the
  same usernames, the same seed password, and the same token settings as the shared realm has today.
- **FR-006**: When the old shared realm exists and the Customer app's realm does not, the seed MUST
  rename the old realm to the Customer app's realm, so every customer keeps their identifier,
  username, password and role, and every order, ticket, seat hold and purchase-limit record still
  belongs to the same customer.
- **FR-007**: In that renamed realm the seed MUST disable, and MUST NOT delete, every account that
  is not a customer (the old copies of admins and gate agents) and the clients of the other two
  apps, so none of them can sign in there. The seed MUST NOT delete any realm, client or account.
  Admins and gate agents get new accounts in their own realms (FR-005).
- **FR-008**: Every app realm MUST use the QueuePass login theme and the display name "QueuePass",
  so every sign-in page looks as it does after `021` and `027`, and names its app.
- **FR-009**: The seed MUST be idempotent: running it any number of times, on a clean system or
  after the rename, MUST converge on the same three realms, clients and users, and MUST NOT change
  an account that is already right. If both the old shared realm and the Customer app's realm exist,
  the seed MUST fail with a message naming both and change nothing.

**Token checks**

- **FR-010**: The Backend MUST accept a token only when its issuer is one of the three app realms,
  and MUST check it against that realm's own published keys, issuer, audience and expiry, as `001`
  requires. Any other issuer, the old shared realm's included, MUST be refused with 401.

> **Note (2026-11-11, spec `037`)**: There are four app realms: `queuepass-admin-rust-app` for the Rust
> Admin app, whose honoured role is `queuepass-admin` (Constitution 3.11.0).
- **FR-011**: From a token of an app's realm the Backend MUST honour only that app's role
  (`queuepass-admin` from the Admin app's realm, `customer` from the Customer app's realm,
  `gate-agent` from the Ticket Booth's realm). Any other QueuePass role in the token MUST be
  ignored, so the call is refused with 403 where that role would be required.
- **FR-012**: Each app's sign-in page MUST refuse an account that belongs to another app, because
  that account is not in its realm, or is there only as a disabled old copy. Each app MUST keep its
  wrong-role page (`001`) for a signed-in token without the app's role; no seeded account reaches it
  any more, so it is tested without a browser sign-in (research R10).

**Unchanged**

- **FR-013**: Nothing else changes: the sign-in flow (Authorization Code with PKCE), tokens in
  memory only, background renewal, the back-button rule, seat release on logout (`015` FR-008), the
  API, its error codes, the QueuePass database, and every sign-in page's look.

### Key Entities

- **App realm**: one per app. Holds that app's client, its one role, and the users with that role.
  Each has its own sign-in session in the browser, its own signing keys, and its own issuer.
- **Old shared realm**: the single realm before this feature. Renamed to become the Customer app's
  realm; its non-customer accounts and other apps' clients disabled there, never deleted.
- **User subject**: the user's identifier in Keycloak, unique across the server, the only identity
  QueuePass stores (Constitution V). Customers keep theirs; admins and agents get new ones.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the three apps signed in as three different users in one browser window, **zero**
  apps are signed out or switched user over 15 minutes of use (three renewals each).
- **SC-002**: Logging out of any one app leaves the other two signed in through their next renewal,
  in **100%** of the 3 combinations (each app logs out once).
- **SC-003**: Opening any app while another is signed in shows that app's own sign-in page in
  **100%** of the 6 orderings of two apps.
- **SC-004**: After the upgrade, **100%** of the 235 seeded accounts sign in to their own app with
  their existing username and password; **100%** of the 200 customers keep their identifier, and
  the number of orders, tickets and seat holds each customer is linked to is **unchanged**; every
  past check-in still shows its agent's username.
- **SC-005**: A token from the wrong realm for an endpoint is refused in **100%** of the
  combinations tested (each realm's token against each role's endpoints, and the old realm's token).
- **SC-006**: From a clean clone, `docker compose up --build` seeds the three realms on the first
  run, and a second run changes nothing.

## Assumptions

- Keycloak keeps one browser session per realm, scoped to the realm's path, and a new sign-in as a
  different user ends the previous user's session in that realm (observed on the stack's Keycloak
  26.0.8, research R2).
- Keycloak user identifiers are unique across the whole server, and renaming a realm keeps its
  users' identifiers, passwords, roles, login theme and display name, while its issuer changes to
  the new name (both observed on Keycloak 26.0.8, research R5).
- No seeded or demo account needs two roles. If one ever does, it gets one account per realm; that
  is not in scope here.
- The browser is a normal one that sends cookies to `localhost:8080` (private windows work the same
  way, with their own cookies).

## Out of Scope

- Two different users of the **same** app in one browser (still needs two browser sessions).
- Telling other tabs of the same app at once when that app logs out (they learn at the next renewal
  or API call, as today).
- Single sign-on between apps (deliberately removed).
- Multi-factor sign-in or password-guessing protection for admins (#59); this feature makes it
  possible per realm later, but does not add it.
