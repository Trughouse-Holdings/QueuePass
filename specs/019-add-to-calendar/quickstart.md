# Quickstart: Validating Add to Calendar

The running-system gate for `019`. Run after the implementation, from a fresh clone, with every
service healthy:

```bash
docker compose up --build -d
npm run ci                    # format, lint, build, and the full suite, as GitHub Actions runs it
```

Mahdi asked for this walk to cover **two events**, each added through the calendar file and through
Google Calendar (2026-10-24): S2–S5 below. Record each step's result in tasks.md (T023).

You need:

- **Admin**: the Admin app (http://localhost:5173), `admin1` / `test123`.
- **Customer**: the Customer app (http://localhost:5174), `customer1` / `test123`, in another browser
  or profile.
- **A calendar app**: Outlook (new or classic) on Windows, or Apple Calendar on a Mac. If the laptop
  has neither, use Google Calendar's import (Settings → Import & export → Import) in a Google account
  you own; that still reads the file with a real calendar parser.
- **Google Calendar** in a browser, signed in to a Google account you own. Delete the test entries
  afterwards.
- A shell (Git Bash on Windows) for the file checks.

Contract and rules: [contracts/README.md](./contracts/README.md), [data-model.md](./data-model.md),
[research.md](./research.md).

## S0: Events and orders

As **Admin**:

1. Use a venue whose address was checked (it shows no "Address not verified"), for example one
   created in spec 013's walk, or create one at `1 Arena Plaza, Louisville, KY 40202`. Call it
   venue **A**. Pick a second venue, **B**, ideally one from before 013 (one-line address).
2. Schedule these events (times in the laptop's zone):
   - **E1** `Rock, Paper; Scissors \ Live` at A, tomorrow 19:30–22:45.
   - **E2** a long name with accents and an emoji, for example `Café Noël 🎉 Fête de la Musique —`
     followed by letters until the form accepts no more (its limit is 200, and the emoji counts as
     two), at B, two days from now 22:00 to 02:00 the next day (it crosses midnight).
   - **E3** `Cancelled Show` at A, three days from now, any times.
   - **E4** `Short Set` at B, starting 10 minutes from now and ending 15 minutes from now.
   - **E5** `Under Way` at A, starting 10 minutes from now and ending 3 hours from now.

As **Customer**, get tickets: two separate orders for E1 (one ticket each), and one each for E2,
E3, E4, and E5 (buy E4 and E5 within the 10 minutes before they start; sales close at the start,
spec 006).

As **Admin**: cancel E3.

Wait until E4 has ended and E5 has started (15 minutes from scheduling them).

An order whose tickets are all void for an event still ahead cannot be made today: the only refund
is cancelling the whole event (spec 005), and single-order refunds (spec 009) are not built. That
case (spec US3 scenario 4) is covered by the automated tests only (tasks T006, T007).

## S1: The controls appear only where they should (US3, FR-001, FR-002, FR-015)

As **Customer**, open **My tickets** (reload it). **Expect**:

- E1: both orders' cards each show an "Add to calendar" group with the note that the entry is a
  copy that won't change, **Add to Apple Calendar or Outlook**, and **Add to Google Calendar**.
- E2 and E5 (under way): the group is shown.
- E3 (cancelled) and E4 (ended): no calendar control, no disabled control; the cards look as before.
- No ticket row has a calendar control.

## S2: Event 1 through the calendar file (US1, FR-004, FR-005, FR-008, FR-009)

On an E1 card, choose **Add to Apple Calendar or Outlook**. **Expect**: a file named
`rock-paper-scissors-live.ics` is downloaded; the browser's network panel shows no request.

Check the file in the shell (replace the path):

```bash
f=~/Downloads/rock-paper-scissors-live.ics
od -c "$f" | head -5                                     # every line ends \r \n
LC_ALL=C awk '{ if (length($0) > 76) print "TOO LONG: " NR }' "$f"   # 75 octets + \r
grep -c $'\r$' "$f"; wc -l < "$f"                        # the two counts are equal
cat "$f"
```

**Expect**: `METHOD:PUBLISH`, `UID:queuepass-event-<E1's id>`, `DTSTART` and `DTEND` ending in `Z`
(19:30 and 22:45 local, converted to UTC), `SUMMARY:Rock\, Paper\; Scissors \\ Live`,
`LOCATION:<venue A's name>\, <venue A's address with \, for each comma>`; nothing printed as too long.

Open the file in the calendar app. **Expect**: it offers one entry (not a meeting to answer) titled
`Rock, Paper; Scissors \ Live`, tomorrow 19:30–22:45 in the laptop's zone, at venue A's name and full
address. Add it.

## S3: Event 2 through the calendar file (folding, non-ASCII, midnight)

On the E2 card, choose **Add to Apple Calendar or Outlook**. **Expect**: a file named after the event's
first letters, at most 60 characters before `.ics`, with `cafe-noel` at the start (the emoji and
accents dropped from the name only). Run the S2 shell checks. **Expect**: the `SUMMARY` folded over
several lines, each continuation starting with one space, none too long. Open it in the calendar app.
**Expect**: the full name with accents and the emoji intact, 22:00 to 02:00 across two
days, at venue B's name and address. Add it.

## S4: Event 1 in Google Calendar (US2, FR-011)

On an E1 card, choose **Add to Google Calendar**. **Expect**: a new tab opens on Google Calendar's
new-entry page (**My tickets** stays in its tab) with the title `Rock, Paper; Scissors \ Live`,
tomorrow 19:30–22:45 in the account's zone, and the location venue A's name and address. Save it.
Look at the link (hover, or copy it): only `action`, `text`, `dates`, and `location`, with `dates`
ending in `Z`.

## S5: Event 2 in Google Calendar

On the E2 card, choose **Add to Google Calendar**. **Expect**: the full name, the
accents and emoji intact, 22:00 to 02:00 across two days, venue B's name and address. Save it.

## S6: Adding again, from another order of the same event (FR-007; record only)

As **Admin**, change E1's end to 23:00. As **Customer**, reload **My tickets** and choose **Add to
Apple Calendar or Outlook** on the *other* E1 order's card. **Expect** (the requirement): its `UID`
line equals the S2 file's (`grep UID` on both), and its `DTEND` is 23:00 local in UTC. Open it in the
same calendar app and **record** what the app does: updates the entry, asks to update it, or adds a
second one. Any of these passes; calendar apps differ (research R4). Google Calendar (S4) still
shows the old end: the entry is a snapshot (FR-006).

## S7: The device's time zone does not change the file (FR-005, SC-002)

In the Customer browser, open DevTools → More tools → Sensors and, under **Location**, choose
**Other…** and set **Timezone ID** to `America/Los_Angeles`. Reload **My tickets**: the shown
times move to that zone. Download E1's file
again. **Expect**: `diff` against the S6 file shows only the `DTSTAMP` line.

## S8: Keyboard, screen reader, and phone width (FR-013, FR-014)

- With the keyboard only, Tab through **My tickets**. **Expect**: each eligible card's two controls
  are reached in order after the event's details, with a visible focus ring; Enter on the button
  downloads the file, Space too; Enter on the link opens Google Calendar in a new tab.
- With a screen reader (Narrator or VoiceOver), **expect** the names "Add to Apple Calendar or
  Outlook: Rock, Paper; Scissors \ Live, downloads a calendar file" and "Add to Google Calendar: …,
  opens in a new tab", in a group named "Add to calendar".
- At 360 pixels wide (DevTools device toolbar), **expect** no horizontal scroll and the two
  controls stacked or wrapped, each at least 44 pixels tall. This is a width check only: what a real
  phone does with the downloaded file is not a requirement (spec Edge Cases).

## S9: Smoke test of every front end (Constitution, Running-system gate)

Sign in to, use, and sign out of the Admin app, the Customer app, and the Ticket Booth app. Delete the
test entries from the calendar app and Google Calendar.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`.

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: set-up for the scenarios below; each browser test sets up its own data through the API |
| S1 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S2 | Automated: `019 S2: a customer downloads the calendar file, with the event, its times, and its venue` |
| S3 | Manual: opening the file in a real calendar app |
| S4 | Manual: Google Calendar in a Google account |
| S5 | Manual: Google Calendar in a Google account |
| S6 | Manual: record only, in a real calendar app |
| S7 | Manual: the device's time zone, checked in a real calendar app |
| S8 | Manual: keyboard, screen reader, and phone width |
| S9 | Manual: sign in, use, sign out, walked by the `001 V3` browser test |
