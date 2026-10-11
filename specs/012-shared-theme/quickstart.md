# Quickstart: Validating the Shared Theme

The running-system gate for `012`. Run after the implementation with every service healthy:

```bash
docker compose up --build -d
docker compose exec backend node backend/dist/scripts/demo-data.js
npm test                      # includes the theme load, token, contrast, and drift tests
```

Open the Admin app (http://localhost:5173, `admin1` / `test123`) in a normal window and the
Customer app (http://localhost:5174, `customer1` / `test123`) in a private window, side by side.

## S1: Side by side, light mode (US1)

With the system in light mode, open the Admin app's **Events** list and the Customer app's
**Events** page, then an event in each. Compare the top bar and its Log out button, the current
navigation item, a primary button, a secondary button, a text field, a menu, a checkbox, a card, a
label/value list, a link, and a Cancelled badge. **Expect**: each pair looks the same: same
accent, typeface, corner rounding, and border. Field borders are clearly visible in both.

## S2: Computed styles match (US1; SC-002)

In each app's browser console, run:

```js
const pick = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { missing: sel };
  const s = getComputedStyle(el);
  return {
    color: s.color,
    background: s.backgroundColor,
    border: s.borderTopColor,
    font: s.fontFamily,
    radius: s.borderTopLeftRadius,
  };
};
console.table({
  primary: pick('.btn--primary'),
  field: pick('input:not([type=checkbox]):not([type=radio]), select'),
  link: pick('main a:not(.btn):not(.rowlink):not(.navlink)'),
  banner: pick('.banner--error'),
});
console.log('accent', getComputedStyle(document.documentElement).getPropertyValue('--accent'));
```

Run it on pages that show the same controls: the Admin **New event** form and the Customer event
page with **Get tickets** (button and field); an Admin event page and a Customer event page (link);
and, with the Backend stopped as in S4, any page in each (banner). **Expect**: each row matches
between the two apps. Switch the system to dark mode, reload both, and run it again. **Expect**:
they match again, with the dark values.

## S3: Dark mode (US1)

With the system in dark mode, repeat S1. **Expect**: both apps use the same dark colors; links
are in the accent color, never browser blue or purple; no text is hard to read.

## S4: Status messages (US3)

1. Stop the Backend: `docker compose stop backend`. Reload an event page in each app.
   **Expect**: "Can't reach the QueuePass service." as the same red banner in both.
2. Start it again: `docker compose start backend`. In the Customer app, open an event that is sold
   out or whose sales are closed, or try to get more tickets than are left. **Expect**: the
   refusal shows as a red banner with the same text as before this feature, and the form keeps
   what was chosen.
3. Compare a Cancelled badge in each app. **Expect**: same colors and border.

## S5: Phone width (spec edge cases; SC-006)

In the browser's device mode at 375 × 812, visit the Customer app's Events, an event with its seat
picker, and My tickets, and the Admin app's Events and an event. **Expect**: no Customer page
scrolls sideways (a wide seat map scrolls inside its own box, as before); every button and field
is at least 44 pixels tall in both apps; the seat picker looks as before.

## S6: One change, both apps (US4; SC-003)

On a scratch branch, change `--accent` in `packages/shared/src/web/theme.css` only (light value
to, say, `#0f766e`). Run `git status`. **Expect**: one changed file. Rebuild the two apps:
`docker compose up --build -d admin-app customer-app`. **Expect**: both show the new accent on
primary buttons, links, and the current navigation item. Revert the change and rebuild.

Then add `color: #ff0000;` to any rule in `customer-app/src/styles.css` and run
`npm test --workspace @queuepass/shared`. **Expect**: the drift test fails, naming the file, the
line, and the color. Revert it.

## Smoke test

Sign in, use, and sign out of each front end, including the Booth app (http://localhost:5175,
`agent1` / `test123`). **Expect**: the Booth app looks exactly as before (browser defaults).
