# Quickstart: Sign-in Background

**Feature**: `027-sign-in-background` | **Spec**: [spec.md](./spec.md)

The running-system gate for this feature. Walk it in real browsers against the stack built from the
implementation branch. Each scenario names the requirements it proves.

## S0. A stack with the new look

1. `docker compose up --build` (a stack from before this feature keeps its data; only the Keycloak
   image is rebuilt). Wait until every service is healthy and the seed has exited 0.
2. **Expected**: no step in the Keycloak admin console; the seed logs `login theme already
   'queuepass'` on a reused realm, as in `021`. (FR-011)

## S1. The stones, in each app's color (US1; FR-001, FR-003, FR-004, FR-005, SC-001)

Open each app signed out, in its own private window, on a desktop-size window:

| App | URL | Lines between the stones |
| --- | --- | --- |
| Admin | http://localhost:5173 | indigo |
| Customer | http://localhost:5174 | teal |
| Ticket Booth | http://localhost:5175 | amber |

**Expected**: Keycloak's grey stones cover the whole window, lighter at the top left, near black at
the bottom right; the stones are grey and only the lines between them are colored, each line on an
edge between two stones; a darker band behind the form fades out within about 120 px on each side,
and beyond it the stones and lines are at full strength (on any window 800 px wide or wider); no card
behind the form. Everything of `021` S1 is still
there: the tab title and heading "Sign in to {app}", the audience line, the accent band at the top,
the brand mark, and the Sign In button in the app's accent. Switch the system to the other color
scheme and reload. **Expected**: the backdrop, its lines, and its text look the same; the fields
and the button follow the scheme.

## S2. Told apart at a glance (SC-006)

Put the three screens side by side and cover the names. Ask someone who has not seen them to say
which is which. **Expected**: 3 of 3 right, within 5 seconds each.

## S3. Readable at every size, in both schemes (US2; FR-006, FR-007, FR-008, SC-002, SC-003)

For each app, in light and dark schemes, at 360×800 (DevTools device mode), 768×1024, 1280×800,
1920×1080, and 2560×1440 (or the largest window the screen allows):

1. **Expected**: the stones cover the window, cropped, never stretched; the lines stay on the
   stones' edges.
2. DevTools' contrast check on the heading, the audience line, the labels, and the Sign In button's
   text. **Expected**: AA passes.
3. At 360 px. **Expected**: no sideways scrolling; every control usable.
4. Browser zoom to 200% and 400% on a 1440-wide window (400% is then 360 CSS px). **Expected**: the
   page reflows; no sideways scrolling; still readable.
5. On Windows, turn on a contrast theme (forced colors), or emulate it in DevTools (Rendering →
   Emulate CSS media feature `forced-colors: active`). **Expected**: no stones, lines, or shade; the
   page in the system's colors, usable.

## S4. Every page has the stones (US3; FR-001, FR-003, FR-005)

1. On each app's page, sign in as `admin1` with the password `wrong`. **Expected**: the stones and
   that app's lines; the message "Invalid username or password." under the fields, light red on the
   stones, readable; the username kept.
2. In each app, sign in (`admin1`, `customer1`, `agent1`, password `test123`), sign out, and choose to
   sign in again. **Expected**: that app's page, with the stones.
3. Open http://localhost:8080/realms/queuepass/account. **Expected**: "Sign in to Account Console"
   on the stones with indigo lines.
4. Open the sign-in page's URL again after it has expired (or with a broken `client_id`).
   **Expected**: Keycloak's notice or error page, on the stones, with the light text.
5. Open http://localhost:8080/admin. **Expected**: Keycloak's admin console, unchanged.

## S5. Keyboard and screen reader (US2; FR-005, FR-008)

On one page per app, in both schemes. **Expected**: focus starts in the username field; Tab goes
username → password → Show → Sign In; every focus ring is clearly visible on the stones, in the
app's accent; Show reveals the password; Enter submits. With VoiceOver: the page title and the one
heading name the app; after a wrong password, the focused field reads the message out; the
background is not announced.

## S6. Without the stones (FR-009, SC-005)

In DevTools, block the request for `keycloak-bg.png` (Network → right-click → Block request URL) and
reload each app's page. **Expected**: a plain stone grey page with the lines still drawn under the
shade, the same light text, every text and control readable; signing in works.

## S7. Keycloak's image, not a copy; the lines image made again (US4; FR-002, FR-010, SC-004)

1. Get Keycloak's image from the running stack: open any sign-in page, read the version in its
   stylesheet links (`/resources/{version}/login/queuepass/css/login.css`), then
   `curl -o keycloak-bg.png http://localhost:8080/resources/{version}/login/keycloak/img/keycloak-bg.png`
   (outside the repository).
2. `npm run stone-lines --workspace @queuepass/seed -- --check <path to keycloak-bg.png>`.
   **Expected**: it reports that the committed
   `keycloak/themes/queuepass/login/resources/img/stone-lines.png` has the same pixels and the same
   `Source` chunk as a fresh run (the file's bytes may differ from a fresh run on another machine,
   so the check compares the decoded image, not the bytes).
3. Run it on any other PNG. **Expected**: it refuses, naming the SHA-256 it expected.
4. Read `keycloak/themes/queuepass/NOTICE`. **Expected**: it names Keycloak's image as the source,
   its SHA-256, its copyright holder, the Apache License 2.0, and the change made;
   `LICENSE-keycloak.txt` is beside it.

## S8. Sign in, use, sign out (Constitution VI)

Sign in to each front end on its new page, use it briefly, and sign out. **Expected**: as before;
signing in takes the same steps as before `027`.

## Tests that run without a browser

- `npm test` (CI): the shared theme's tokens, the backdrop's contrast, and the drift check with the
  seventh role; the theme files, the lines image and its notice, no copy of Keycloak's image; the
  generator.
- With the stack up: `npm test --workspace @queuepass/seed` also runs the live sign-in page test
  (the backdrop element on every page; Keycloak's image served with the recorded SHA-256; the lines
  image served).

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`.

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: a stack with the new look, which every `npm run e2e` starts |
| S1 | Automated: `027 S1: each app's sign-in page shows the stones with its accent in the lines and no card`; rest Manual: the look checked by eye |
| S2 | Manual: told apart by a person |
| S3 | Manual: until T017 adds `027 S3: every text, field edge and focus ring on the stones meets its contrast at five window sizes, light and dark`; zoom is checked by hand |
| S4 | Manual: the wrong-password page is in S3's test; the other pages are covered by the live seed test and walked by hand |
| S5 | Manual: keyboard and screen reader pass |
| S6 | Manual: until T023 adds `027 S6: with the stones image blocked, the sign-in page stays readable` |
| S7 | Manual: needs Keycloak's image outside the repository; the generator is covered by `scripts/seed`'s tests |
| S8 | Manual: sign in, use, and sign out of each front end, by hand |
