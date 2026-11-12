# UI Contract: Admin Parity Checklist

**Feature**: `037-rust-admin-app` | Spec FR-012 to FR-015, SC-002

The Rust Admin app MUST do everything on this list the way the React Admin app does on `main` when
the implementation PR opens. "The same" means the same values saved, the same Backend refusals
shown with the same meaning beside the same field, the same values kept after a refusal, and the
same figures. Layout and color may differ. Accessible names (labels, headings, button text) MUST
be the same, so one set of browser tests drives both apps (research R10).

The React Admin app's source and its merged specs are the reference. Where this list and the React
Admin app disagree, the React Admin app wins, and this list is corrected in the implementation PR.
The implementer works through the React source file by file (the "Source" column) and ticks each
item in the implementation PR, marking how it was checked: **E** (browser test, named), **U** (unit
test in `core`), or **M** (checked by hand, with the date).

## Shell and sign-in

| # | Behavior | Specs | Source |
|---|---|---|---|
| S1 | Sign-in required before any page, through realm `queuepass-admin-rust-app` | 001, 028 | `packages/shared/src/web/auth-provider.tsx` |
| S2 | Tokens in memory only; token renewal before expiry; after a failed renewal, retry with the refresh token every 30 s and when the browser comes back `online` | 018 R12 | same |
| S2b | After sign-in, return to the page that was asked for (`returnTo`) | 001, 002, 015 | same |
| S2c | Shown from the back-forward cache: check sign-in again; `index.html` served `no-store` | 001 SC-007 | same, `admin-app/nginx.conf` |
| S3 | "Log out" button ends the app's session and the realm's Keycloak session | 001, 028 | `logout-button.tsx` |
| S4 | Wrong role: plain message, no data, sign-out offered | 001 | `require-role.tsx`, `wrong-role.tsx` |
| S5 | Backend unreachable: plain message | 001 | `service-unreachable.tsx` |
| S6 | Home page shows the Backend's admin greeting (`/hello/admin`) | 001 | `hello-page.tsx` |
| S7 | Header: brand "QueuePass Admin (Rust)" linking to Venues, navigation (Venues, Events, Reports), "Log out"; tab title "QueuePass Admin (Rust)" | 001, 021 | `App.tsx` |
| S9 | Error banner: a `SCHEDULING_CONFLICT` refusal has its own look, told apart from other errors (amber in the React app) and still told apart under the red theme | 002 FR-034 | `components/ErrorBanner.tsx` |
| S10 | One-time notices after an action (for example `Deleted "…"`), cleared from history so Back or a reload doesn't show them again | 002 | `components/Notice.tsx`, `components/SuccessState.tsx` |
| S8 | Red on every screen; AA contrast; visible focus; non-color state cues; phone-width layout; keyboard access | spec FR-009–FR-011 | (new) |

## Venues

| # | Behavior | Specs | Source |
|---|---|---|---|
| V1 | Venue list: name, address, seating capacity, time zone; search by name or address ("Name or address, such as a city"); empty state "No venues yet"; load error | 002, 004 | `pages/LocationList.tsx` |
| V2 | Venue form (create and edit): name, street address, city, state (choose a state, from `US_STATES`), ZIP code (`ZIP_PATTERN`), time zone (always picked from the list), seating capacity, seating sections (Rows × Seats per row with each line's seat count) | 002, 007, 020, 024 | `pages/LocationForm.tsx`, `components/SectionLines.tsx`, `packages/shared/src/location.ts`, `time-zone.ts` |
| V3 | Save: verified when the address service matches; otherwise saved as typed and marked not verified, also when the service is down; one step | 013, 024 | `pages/LocationForm.tsx` |
| V4 | Backend refusals beside their field; every value kept | 002, IV | same |
| V5 | Venue page: address with Google Maps link, "Not verified" note with "Edit the venue to verify it", time zone, capacity, seating layout card, Events here (Event, Starts, Ends) with past events hidden and the toggle, "Nothing is scheduled here." | 002, 007, 013, 020, 030 | `pages/LocationDetail.tsx`, `address-link.tsx` |
| V6 | Change the seating layout from the venue page (Section, Size, Seats); "Could not change the layout" with the reason | 007, 024 | `components/LayoutCard.tsx` |
| V7 | Delete venue with confirmation; "Could not delete" with the reason; "This venue no longer exists." | 002 | `pages/LocationDetail.tsx`, `hooks/use-delete.ts` |

## Events

| # | Behavior | Specs | Source |
|---|---|---|---|
| E1 | Event list: Event, Venue, Date, Time (venue time zone), Base price, Tickets; filters: name, venue (All venues), From/To dates ("From must be on or before To."); Show past events toggle, past events marked Ended; cancelled marked; empty states ("No events scheduled", "No events match these filters.", "Past events are hidden.") | 002, 004, 020, 030 | `pages/EventList.tsx` |
| E2 | Event form, section Venue and times: venue (Select a venue…), event name, Starts and Ends each a date control and a time control in the venue's time zone; a new event starts today at the next whole hour and ends 4 hours later; doors open as How long before the start (15-minute steps, 0–6 h, default 1 h) or as a date and a time, one at a time, switching keeps the instant; skipped and repeated local times handled | 020, 025, 035, 036 | `pages/EventForm.tsx`, `pages/DateTimeFields.tsx`, `pages/event-form-times.ts` |
| E3 | Section Tickets and seating: total tickets or reserved seating; ticket types (name, price, quantity; add and remove); each venue section mapped to a ticket type or Not for sale; live total of seats assigned per type and overall against the layout | 004, 007, 031, 035 | `pages/EventForm.tsx` |
| E4 | Section Details: tickets per customer (No limit or a number); images (Add images, up to 5, reorder earlier and later, remove) | 014, 016, 035 | `components/ImagesField.tsx` |
| E4b | Picture checks before upload, per file with its own note: type sniffed from the file's bytes (`readImageHeader`), the size limit, and the pixel limits | 014 | `components/ImagesField.tsx`, `packages/shared/src/event-image.ts` |
| E4c | Base price format (`BASE_PRICE_PATTERN`) and the doors-open helpers | 002, 025 | `packages/shared/src/event.ts` |
| E5 | Field checks: on leaving a field, then as the admin types; cleared when fixed; announced politely; submit never sends a known problem and focuses the first field at fault | 035 | `pages/event-form-checks.ts` |
| E6 | Schedule saves event, ticket types, and seating all or nothing; pictures upload after, with a per-picture failure message | 014, 031 | `pages/EventForm.tsx`, `api/events.ts`, `api/images.ts` |
| E7 | Backend refusal (for example venue clash within the 60-minute buffer) beside its field and focused; every value kept | 002, 031, 035 | same |
| E8 | Edit: same form; controls the Backend would refuse because tickets are sold are locked with the reason; saved all or nothing; edits after check-in details are removed are refused as the Backend says | 032, 035 | same |
| E9 | Event page: venue, times with zone, doors open, base price, per-customer limit, status (Cancelled, Ended), image gallery that rotates every `GALLERY_INTERVAL_MS` with its pause control, and the full-size image viewer | 002, 014, 016, 020, 025, 030 | `pages/EventDetail.tsx`, `image-gallery.tsx`, `image-viewer.tsx`, `use-gallery-rotation.ts` |
| E10 | Ticket tiers card: list, add a tier, edit name, price, quantity; "Could not save the tier" with the reason | 004 | `components/TierSection.tsx` |
| E11 | Sales card: per tier Sold and Revenue | 005 | `components/SalesCard.tsx` |
| E12 | Seating card: each section's tier or Not for sale, Save seating, "Could not change seating", "Seating is unavailable right now." | 007 | `components/SeatingCard.tsx` |
| E13 | Seat map: each seat "Row r, Seat s" with sold, held, or open told apart without color alone; updates live from the seat stream (reconnects at token expiry) | 007, 015 | `components/SeatGrid.tsx`, `seat-stream.ts` |
| E14 | Cancel event with confirmation ("Could not cancel"), delete event with confirmation ("Could not delete"), "This event no longer exists." | 002, 005 | `pages/EventDetail.tsx` |

## Attendees and reports

| # | Behavior | Specs | Source |
|---|---|---|---|
| A1 | Attendees: event name, columns Customer, Name on tickets, Tier, Tickets, Ticket codes, Total, Status, Check-in; "Check-in details removed on …" after removal | 005, 017, 032 | `pages/Attendees.tsx` |
| A2 | Download the attendee list: CSV, XLSX, PDF, same rows and columns, made-at time, "Made by <username>", the time-zone note, and the Attendees privacy note | 023 | `export/*` |
| R1 | Reports: Revenue, Tickets sold (% of capacity, meter), Checked in (% of sold, meter), Scheduled events; By event table with % sold | 005, 023, 032 | `pages/Reports.tsx` |
| R2 | Download the sales report: CSV, XLSX, PDF, same rows and columns, made-at time, "Made by <username>", the time-zone note | 023 | `export/*` |
| X1 | CSV: UTF-8 BOM, CRLF, an `Exported at` column on every row, `'` prefix on cells starting `=`, `+`, `-`, `@` | 023 | `export/csv.ts` |
| X2 | XLSX: numbers, dates, and money as typed cells with the same formats | 023 | `export/xlsx.ts` |
| X3 | PDF: embedded Noto Sans; a missing character becomes `?` with `REPLACED_NOTE`; header repeated per page; `nowrap` columns | 023 | `export/pdf.ts` |
| X4 | Made-at time and file names in the admin's own device time zone | 023 | `export/made.ts`, `export/file-name.ts` |
| X5 | Size targets: an event of 5,000 and of 25,000 tickets exports in all three formats | 023 | `admin-app/test/export/size.test.ts` |
| R3 | Money is exact (integer cents or decimal strings), USD, formatted as the React app formats it | constitution | `money.ts`, `format.ts` |
