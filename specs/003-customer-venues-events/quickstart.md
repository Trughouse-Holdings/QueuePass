# Quickstart: Validating Customer Venue and Event Browsing

The running-system gate for `003` (Constitution VI). Run it after the `003` implementation, with
the system up. It assumes the `001` and `002` quickstarts already pass.

## Prerequisites

- `docker compose up --build -d`, with every service healthy (see `001` quickstart V1).
- Two private browser windows: **A** for the Admin app (http://localhost:5173, `admin1`) and
  **B** for the Customer app (http://localhost:5174, `customer1`). Password `test123`.

## C1: Events appear, soonest first (US1; FR-001, FR-002, FR-006, FR-007, FR-014, SC-005)

1. In **A**, add venues `Zeta Hall` and `Alpha Arena`. Add `Late Show` at Zeta Hall for next
   week 22:00–02:00 (next day), price `1200`, and `Early Show` at Alpha Arena for tomorrow
   18:00–21:00, price `45.5`.
2. In **B**, sign in. **Expect**: the landing page is the event list. `Early Show` is above
   `Late Show`. Each row shows its venue, start and end in local time, both with dates, and the
   prices `$45.50` and `$1,200.00`. `Late Show`'s end date is the day after its start date.
3. In **A**, add `Matinee` at Alpha Arena tomorrow 12:00–14:00. In **B**, reload. **Expect**:
   `Matinee` appears at the top.

## C2: Venues and what is on at each (US2; FR-003, FR-004, FR-005)

1. In **B**, click **Venues**. **Expect**: `Alpha Arena` above `Zeta Hall`, each with its
   address and seating capacity.
2. Open **Alpha Arena**. **Expect**: its details, then `Matinee` and `Early Show`, soonest first.
3. Open **Early Show**. **Expect**: its details and a link to **Alpha Arena** that works.
4. In **A**, add venue `Empty Room`. In **B**, reload Venues and open it. **Expect**: "Nothing
   is scheduled here."

## C3: Read-only (US3-1; FR-009, SC-003)

On every page in **B**, **expect** no Add, Edit, Save, or Delete control. In developer tools,
Network tab, every request to `localhost:3000` is a `GET` carrying `Authorization: Bearer`.

## C4: Missing records and empty lists (FR-008)

1. In **B**, open `Matinee`'s page and keep it open. In **A**, delete `Matinee`. In **B**,
   reload. **Expect**: "This event is no longer available." with a link back to events.
2. In **A**, delete every event. In **B**, reload the event list. **Expect**: "Nothing is
   scheduled yet."

## C5: Sign-in and role (US3-2 to US3-4; FR-011, SC-004)

1. In **B**, click **Log out**. **Expect**: the Keycloak login page.
2. Paste `http://localhost:5174/venues` into **B**. **Expect**: the Keycloak login page; no data.
3. Sign in to **B** as `admin1`. **Expect**: "Your account can't use this app." and a logout
   control; no venue or event data.

Clean up in **A** by deleting the quickstart venues.
