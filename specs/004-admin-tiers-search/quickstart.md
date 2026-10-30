# Quickstart: Validating Admin Ticket Tiers and Search

The running-system gate for `004`. Run after the implementation with `docker compose up --build
-d` and every service healthy. Sign in to http://localhost:5173 as `admin1` / `test123`.

## T1: Tiers within capacity (US1; FR-001–FR-005)

1. Add venue `Tier Hall` (capacity 2000) and event `Tier Test` there, capacity `1000`, price
   `45.00`.
2. On the event page, add `General`, `45.00`, `800`. **Expect**: listed; "Allocated 800 of 1,000".
3. Add `VIP`, `120.00`, `500`. **Expect**: refused; the banner says 200 remain; the form keeps
   your values.
4. Change the quantity to `200` and add. **Expect**: listed; "Allocated 1,000 of 1,000".
5. Add `vip`, `10`, `1`. **Expect**: refused as a duplicate name.
6. **Edit** the event and set capacity `900`. **Expect**: refused, naming the tier total 1,000.
7. **Edit** VIP to quantity `100`, then **Remove** General (confirm). **Expect**: one tier left.

## T2: Event search (US2; FR-006, FR-008)

1. Add events `Spring Show` and `Autumn Gala` at Tier Hall in different months.
2. On **Events**, search `show`. **Expect**: Spring Show only (and Tier Test if it matches).
3. Clear, pick venue Tier Hall and a date range covering only Autumn Gala. **Expect**: Autumn
   Gala only. Reload. **Expect**: same filters, same result.
4. Search `zzz`. **Expect**: "No events match these filters." with **Clear**.

## T3: Venue search (US3; FR-007)

On **Venues**, search `tier`. **Expect**: Tier Hall only. Search part of its address. **Expect**:
same.

## T4: Customer app unaffected

Sign in to http://localhost:5174 as `customer1`. **Expect**: events and venues still listed.

Clean up by deleting the test events and venue.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`.

| Scenario | Browser test |
| --- | --- |
| T1 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| T2 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| T3 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| T4 | Manual: the Customer app's lists, walked by the `003 C1` browser test |
