# Quickstart: Event Form Times

Walk the Admin event form's doors-open modes and the split date and time controls. Times are in
the venue's zone (`020`). The Backend is unchanged; the form still sends `doorsOpenAt`.

## S0: A venue and a signed-in admin

Use a venue already on the system, or create one. Sign in to the Admin app as an admin. The
browser tests make their own venues through the API.

## S1: Doors 2 hours before the start, seen by a customer

Schedule an event. Leave Doors open on "Before the start" and choose **2 hours before**. Set a
start (for example 7:00 PM) and an end. The form shows "Doors open at 5:00 PM" (with the venue's
abbreviation). Save. In the Customer app, that event shows doors at 5:00 PM in the venue's zone.

## S2: Switching modes keeps the time

On a new event, start 7:00 PM, doors 1 hour before (shown as 6:00 PM). Switch to "At a set time":
the date and time are 6:00 PM that day. Switch back: the length is 1 hour before, and the shown
time is still 6:00 PM.

## S3: Moving the start in "Before the start" mode

With doors 1 hour before and start 7:00 PM (doors 6:00 PM), change the start to 8:00 PM. The
length stays 1 hour before, and the shown time becomes 7:00 PM.

## S4: Moving the start in "At a set time" mode

Switch to "At a set time" with doors at 6:00 PM and start 7:00 PM. Change the start to 8:00 PM.
Doors stay at 6:00 PM (still in range). Change the start to 11:00 AM the same day: doors at 6:00
PM are out of range; the form shows the range message and does not send.

## S5: Date and time controls, skipped and repeated times

Starts and Ends are a date control and a time control. A start the venue zone skips is still
refused (`020`). A repeated local time is still asked which occurrence is meant. A refused save
keeps the date and time entered.

## S6: WebKit

The event-form browser tests also run in WebKit in CI (Safari's engine). A walk on a real Mac or
iPhone Safari is still done by hand.

## S7: Event-list date filters

The Admin and Customer From and To filters stay date-only and still work as they do today.

## Automation

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: setup by hand; the browser tests make their own venues through the API |
| S1 | Automated: `036 S1: an event with doors 2 hours before the start shows that time in the Customer app` |
| S2 | Manual: covered by the Admin app's tests (mode switch keeps the instant) |
| S3 | Manual: covered by the Admin app's tests (offset kept when the start moves) |
| S4 | Manual: covered by the Admin app's tests (doors stay put; range message) |
| S5 | Manual: covered by the Admin app's tests and by `020`'s existing browser test, retargeted to the date and time controls |
| S6 | Manual: the S1 test (and the other event-form journeys) also run in the WebKit project in CI once the impl lands; a real Safari walk is by hand |
| S7 | Manual: no behaviour change; visual consistency of the date-only filters |
