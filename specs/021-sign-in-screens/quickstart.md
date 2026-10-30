# Quickstart: Sign-in Screens

**Feature**: `021-sign-in-screens` | **Spec**: [spec.md](./spec.md)

The running-system gate for this feature. Walk it in real browsers against the stack built from the
implementation branch. Each scenario names the requirements it proves.

## S0. A clean stack

1. From a fresh clone (or `docker compose down -v` to drop Keycloak's data): `docker compose up
   --build`. Wait until every service is healthy and the seed has exited 0.
2. The seed log says `created realm 'queuepass'` and `set login theme 'queuepass'` (or, on a reused
   realm, `login theme already 'queuepass'`). **Expected**: no step in the Keycloak admin console.
   (FR-009, SC-003)

## S1. Three screens, three identities (US1; FR-001, FR-002, FR-005, FR-006, SC-001)

Open each app signed out, in its own private window:

| App | URL | Tab title and heading | Audience line | Accent |
| --- | --- | --- | --- | --- |
| Admin | http://localhost:5173 | Sign in to QueuePass Admin | For administrators managing venues, events, and sales. | indigo |
| Customer | http://localhost:5174 | Sign in to QueuePass Tickets | For customers buying and viewing tickets. | teal |
| Ticket Booth | http://localhost:5175 | Sign in to QueuePass Ticket Booth | For gate agents checking tickets in at the door. | amber |

**Expected**: each row as written; the brand mark, the primary button, and the top band use the
app's accent; the form is username or email and password, with no registration link.

## S2. Told apart at a glance (SC-002)

Put the three screens side by side and cover the names. Ask someone who has not seen them to say
which is which. **Expected**: 3 of 3 right, within 5 seconds each.

## S3. A wrong password (US2; FR-004, FR-011, FR-012)

On each screen, sign in as `admin1` with the password `wrong`. **Expected**: the same app identity;
the error "Invalid username or password." under the fields, in the danger color (a screen reader
announces it); the username kept. Then sign in with `test123` (`admin1`, `customer1`, `agent1` for each app). **Expected**:
back in the app, signed in, as before.

## S4. Signing out and back in; a session that ended (US2)

1. In each app, sign out, then choose to sign in again. **Expected**: that app's screen.
2. In the Admin app, signed in: in the Keycloak admin console (http://localhost:8080, `admin` /
   `admin`), **Sessions** → sign out `admin1`'s session. Back in the Admin app, do something that
   calls the API or reload. **Expected**: the Admin sign-in screen.

## S5. Phone width and color schemes (US4; FR-012, SC-005)

For each screen: DevTools device mode at 360 px wide. **Expected**: no sideways scrolling; every
control usable. Switch the system (or DevTools' emulated) color scheme between light and dark.
**Expected**: the screen follows it; text and controls readable; DevTools' contrast check passes
AA for the heading, audience line, labels, button, and error.

## S6. Keyboard and screen reader (US4; FR-012)

On one screen per app: **Expected**: focus starts in the username field; Tab goes username →
password → Show → Sign in, with a visible focus ring; Show reveals the password and reads "Hide";
Enter submits. With VoiceOver: the page title and
the one heading name the app.

## S7. The no-app fallback (FR-008)

Open http://localhost:8080/realms/queuepass/account in a browser (its page redirects to sign-in in
JavaScript). **Expected**: "Sign in to Account Console",
the QueuePass look, the indigo accent, no audience line.

## S8. A stack from before this feature (US3; FR-010, SC-004)

1. Check out `main` from before this feature, `docker compose up --build`, wait for the seed.
2. Check out the implementation branch, `docker compose up --build` again (Keycloak's data kept).
   **Expected**: the seed says `set login theme 'queuepass'` and converges `customer-app`; S1 holds;
   every test account still signs in.
3. Run the seed a third time (`docker compose run --rm seed`). **Expected**: `login theme already
   'queuepass'`; nothing else changes.

## S9. The Customer app's own name (FR-003)

Signed in to the Customer app. **Expected**: the tab title and the header say "QueuePass Tickets".
The Admin and Ticket Booth apps are unchanged.

## Tests that run without a browser

- `npm test` (CI): shared theme tokens, contrast, and drift (including `login.css`); seed settings;
  theme files; the Customer app's name.
- With the stack up: `npm test --workspace @queuepass/seed` also runs the live sign-in screen test
  (title, heading, audience line, body class, wrong password, account console).
