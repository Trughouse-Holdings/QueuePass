# Quickstart: Season Setup (Admin Side)

**Feature**: `041-season-setup` | **Spec**: [spec.md](./spec.md) | **Contract**:
[contracts/README.md](./contracts/README.md)

Walk these once 041's implementation is running. Each scenario names the user story or
requirement it proves. Do every Admin step in the **Admin app** (http://localhost:5173) and again in
the **Rust Admin app** (http://localhost:5176): they must behave the same (FR-022).

## Prerequisites

- A fresh clone, `.env` from `.env.example`, `docker compose up --build`, seed done.
- The demo reset run once (`029`), so the KFC Yum! Center, its Basketball layout and the demo
  Season exist.
- Sign in as `admin1` (see the README for the password).

## S0. The demo has a Season on sale (US5, FR-023)

Open **Seasons**. "Louisville Cardinals Basketball 2026–27" is listed: KFC Yum! Center,
Basketball, Louisville Cardinals, 3 events, status "Presale until …" (3 days from the reset), 0
passes sold. Open it: its 3 games, a price for every Basketball level, sales end at the first
game's start.

## S1. Create and put on sale a seated Season (US1, SC-001)

New Season → name "Spring Hoops", the Yum! Center, layout Basketball, sport Basketball, team
"Test Team", sales end tomorrow at 18:00. The picker lists only upcoming Basketball-layout events at
the Yum! Center that are not in a Season; tick 2. Price every level. Save: a draft. Put on sale:
status "On sale". Time it: under 3 minutes.

## S2. Required fields and both-or-neither (US1)

New Season, Save with nothing filled: name, venue and sales end are marked beside their fields as
the event form marks them, focus on the name. Pick a sport with no team: refused beside Team.

## S3. Publishing refused with a level unpriced (US1, FR-010)

A draft with 2 events and one level's price empty: Put on sale is refused, the message beside that
level's price box; the Season stays a draft.

## S4. Sales end and presale limits (US1, FR-006)

Set sales end after the first chosen event starts: refused beside Sales end. Set single tickets on
sale after sales end: refused beside that field.

## S5. Events locked after a sale (US2, FR-005)

On a Season with a pass sold (in 041 alone: the Backend test fixture; after 042: buy one in the
Customer app), the event picker is locked with "Passes have been sold" beside it; the price can
still change and saves.

## S6. Delete a draft (US2, FR-008)

Delete a draft with no passes after confirming: it leaves the list; its events show in another new
Season's picker.

## S7. Cancel a Season (US2, FR-014, SC-006)

Cancel a Season on sale: the confirmation says how many passes will be refunded. After it, the
Season reads "Cancelled", its form is read-only, its pass orders are refunded in each event's
attendee list, and its events are still scheduled.

## S8. An event in a Season (US2, FR-007, FR-019)

Open one of the demo Season's games in Events → Edit: "In season: Louisville Cardinals Basketball
2026–27" shows, and the layout control is locked with that reason. Through the API, `PUT
/events/{id}` with another layout is `409 EVENT_IN_SEASON` naming the Season.

## S9. Reports and attendee list mark pass sales (US3, FR-020, FR-021)

With a pass sold: Reports shows Pass tickets and Pass revenue per event and in the total row; the
attendee list's Pass column names the Season on the pass order. Download the sales report and the
attendee list as CSV, Excel and PDF: the same figures and marks.

## S10. The presale shows on the event (US4, FR-013)

`GET /events/{id}` (any role) of a demo Season game: `singleSalesOpenAt` is the Season's time and
`season` names it. The Admin event page says "Single tickets on sale from …" in the venue's time
zone. Clear the Season's single-tickets time: the event's `singleSalesOpenAt` is `null` at once.

## S11. Both Admin apps match (FR-022, SC-004)

The `037 S11` browser check passes with the Seasons routes in its list.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`. S0, S1 and S8 are Automated by
`e2e/tests/041-season-setup.spec.ts` (tagged `@admin`, so they also run against the Rust Admin
app); `037 S11` compares the Seasons pages of both apps.

| Scenario | Browser test |
| --- | --- |
| S0 | Automated: `041 S0: after the reset, the Basketball Season is on sale with its three games and a price for every level` |
| S1 | Automated: `041 S1: an admin creates a seated Season, prices every level and puts it on sale` |
| S2 | Manual: covered by the Admin app's `SeasonForm` test and the Rust core's `forms::season` tests |
| S3 | Manual: covered by the Backend `seasons` publish test and the Admin `SeasonForm` test |
| S4 | Manual: covered by the Backend `seasons` validation test |
| S5 | Manual: needs a sold pass, which only the Backend fixture makes before 042; Backend `seasons` test |
| S6 | Manual: covered by the Backend `seasons` test and the Admin `Seasons` page test |
| S7 | Manual: covered by the Backend `seasons.cancel` test |
| S8 | Automated: `041 S8: an event in a Season shows its Season and locks its layout` |
| S9 | Manual: file downloads; covered by the Admin export row tests and the Backend `reports` test |
| S10 | Manual: covered by the Backend `events` read test |
| S11 | Manual: the `037 S11` test itself is the check; its route list gains the Seasons routes |
