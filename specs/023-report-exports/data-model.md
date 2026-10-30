# Data Model: Report Exports

**Feature**: `023-report-exports` | **Spec**: [spec.md](./spec.md)

No Backend, database, or contract change. The model is the Admin app's table model (research R3).

## Table model

```ts
type Cell =
  | { kind: 'text'; value: string }
  | { kind: 'dateTime'; value: string }   // venue wall-clock 'YYYY-MM-DDTHH:mm', or '' when empty
  | { kind: 'money'; value: string }      // '45.00'
  | { kind: 'count'; value: number };

interface ExportTable {
  title: string;               // 'Attendees: Season Opener' | 'Sales report'
  subtitle: string[];          // made at, made by (useAuth().username), zone note
  madeAt: string;              // RFC 3339 with offset (R7)
  sheetName: string;           // 'Attendees' | 'Sales'
  columns: { header: string; kind: Cell['kind']; width: number }[];
  rows: Cell[][];
}
```

## Attendee rows (FR-004), from `Order[]` (oldest first) and each order's `tickets`

| Column | Kind | From |
| --- | --- | --- |
| Order placed | dateTime | `order.createdAt` in the event's venue zone |
| Customer | text | `order.customerUsername` |
| Name on tickets | text | `order.holderName`, or "No name on ticket" |
| Tier | text | `order.tierName`, or "General admission" |
| Seat | text | `seatLabel(ticket.seat)`, or empty |
| Ticket code | text | `ticket.code` |
| Ticket status | text | VALID → "Valid", VOID → "Void" |
| Checked in | dateTime | `ticket.checkedInAt` in the venue zone, or empty |
| Order status | text | CONFIRMED → "Confirmed", REFUNDED → "Refunded" |
| Price | money | `order.unitPrice` |
| Order | text | the first 8 characters of `order.id`, upper case |

## Sales rows (FR-005), from `SalesReport.events` in order, then Total

| Column | Kind | Event row | Total row |
| --- | --- | --- | --- |
| Event | text | `name` | "Total" |
| Venue | text | `venueName` | empty |
| Starts | dateTime | `startsAt` in `timeZone` | empty |
| Time zone | text | `zoneName(timeZone)` (e.g. "Eastern Time") | empty |
| Status | text | "Scheduled" / "Cancelled" | `"<n> scheduled events"` |
| Tickets sold | count | `ticketsSold` | `totals.ticketsSold` |
| Ticket capacity | count | `ticketCapacity` | `totals.ticketCapacity` |
| Revenue | money | `revenue` | `totals.revenue` |
| Checked in | count | `checkedIn` | `totals.checkedIn` |
