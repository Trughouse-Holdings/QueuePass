# Quickstart: Validating Customer Event Search and Usability

The running-system gate for `008`. Run after the implementation with every service healthy:

```bash
docker compose up --build -d
docker compose exec backend node backend/dist/scripts/demo-data.js
```

Open http://localhost:5174 in a private window and sign in as `customer1` / `test123`.

## E1: Find events (US1)

On **Events**, type "gala". **Expect**: only matching events, after a short pause. Choose a venue,
then set a date range. **Expect**: results narrow each time, soonest first, and the address shows
the filters. Reload. **Expect**: the same filters and results. Turn on **Hide cancelled**.
**Expect**: the cancelled demo event disappears. Type "zzz". **Expect**: "No events match your
filters" and **Clear filters**, which restores every event.

## E2: A bad address (edge cases)

Open `/events?venue=nope&from=2026-13-45`. **Expect**: the full list, no error.

## E3: Cards and badges (US2, US3)

**Expect**: events as cards with name, date, venue, base price, and a red **Cancelled** badge on
the cancelled event. Open a venue. **Expect**: the same cards. Open an event with tiers. **Expect**:
"from $X" and, where they apply, Sold out or Sales closed badges.

## E4: Phone width (US2; SC-002)

In the browser's device mode at 375 × 812, visit Events, an event, its seat picker (a seated
event from `007`), and My tickets. **Expect**: no sideways scrolling of the page (a wide seat map
scrolls inside its own box); every button and field is comfortably tappable.

## E5: Seat states and keyboard (US3; SC-003, SC-004)

On a seated event, choose two seats. **Expect**: open, chosen (✓), and taken (✕, striped) seats
look different. Turn on the system's grayscale filter. **Expect**: still different. Using only
Tab, Space, and Enter, choose a tier, a section, a seat, and confirm. **Expect**: every step works
and the focused control is outlined.
