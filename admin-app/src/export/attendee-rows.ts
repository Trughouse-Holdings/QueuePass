import {
  DEFAULT_TIME_ZONE,
  toLocalDateTime,
  zoneName,
  type Event,
  type InstantLike,
  type Order,
  type Ticket,
} from '@queuepass/shared';
import { removedNote, seatLabel } from '../format';
import { deviceZone, madeLines } from './made';
import type { Cell, ExportColumn, ExportTable } from './table';

const text = (value: string): Cell => ({ kind: 'text', value });
const dateTime = (value: string): Cell => ({ kind: 'dateTime', value });

const TICKET_STATUS: Record<Ticket['status'], string> = { VALID: 'Valid', VOID: 'Void' };
const ORDER_STATUS: Record<Order['status'], string> = {
  CONFIRMED: 'Confirmed',
  REFUNDED: 'Refunded',
};

/**
 * Spec 038: Price level's room comes from Name on tickets, Tier and Seat, so the PDF's minimum
 * widths still fit letter landscape with the widest values (023 review round 1; `pdf.fit.test`).
 */
const COLUMNS: ExportColumn[] = [
  { header: 'Order placed', kind: 'dateTime', width: 18 },
  { header: 'Customer', kind: 'text', width: 17 },
  { header: 'Name on tickets', kind: 'text', width: 20 },
  { header: 'Tier', kind: 'text', width: 15 },
  { header: 'Price level', kind: 'text', width: 14 },
  { header: 'Seat', kind: 'text', width: 20 },
  { header: 'Ticket code', kind: 'text', width: 15, nowrap: true },
  { header: 'Ticket status', kind: 'text', width: 13 },
  { header: 'Checked in', kind: 'dateTime', width: 18 },
  { header: 'Order status', kind: 'text', width: 17 },
  { header: 'Price', kind: 'money', width: 11 },
  { header: 'Order', kind: 'text', width: 11, nowrap: true },
];

/**
 * Spec 023 FR-004 (data-model.md): one row per ticket, carrying its order's details, in the
 * page's order (the Backend's, oldest order first). Spec 038 FR-030 (research R17): a Price level
 * column beside Tier, and Price is each ticket's own (`Ticket.price`). Every time is in the venue's zone (R4).
 * Spec 032 FR-012 (research R8): for an event whose check-in details were removed, the Checked in
 * column stays, empty in every row, and the heading lines say so, with `keptCheckedIn`, the
 * report's kept count, when it could be read.
 */
export function attendeeTable(
  event: Event,
  orders: Order[],
  madeAt: InstantLike,
  madeBy: string,
  adminZone: string = deviceZone(),
  keptCheckedIn?: number | null,
): ExportTable {
  const zone = event.location.timeZone ?? DEFAULT_TIME_ZONE;
  const local = (iso: string | null): Cell => dateTime(iso ? toLocalDateTime(iso, zone) : '');
  const made = madeLines(madeAt, madeBy, adminZone);
  const removedAt = event.checkInDetailsRemovedAt ?? null;
  const removed = removedAt
    ? [
        removedNote(removedAt, zone),
        ...(keptCheckedIn == null
          ? []
          : [
              keptCheckedIn === 1
                ? '1 ticket was checked in.'
                : `${keptCheckedIn.toLocaleString('en-US')} tickets were checked in.`,
            ]),
      ]
    : [];

  const rows = orders.flatMap((o) =>
    o.tickets.map((t): Cell[] => [
      local(o.createdAt),
      text(o.customerUsername),
      text(o.holderName ?? 'No name on ticket'),
      // Spec 038 FR-030 (research R17): a seat is never general admission; its level is beside.
      text(o.tierName ?? (t.seat || t.levelName ? '' : 'General admission')),
      text(t.levelName ?? ''),
      text(t.seat ? seatLabel(t.seat) : ''),
      text(t.code),
      text(TICKET_STATUS[t.status]),
      // Research R13b: a void ticket shows no check-in, as the page shows only "(void)".
      local(t.status === 'VOID' || removedAt ? null : t.checkedInAt),
      text(ORDER_STATUS[o.status]),
      // Spec 038 FR-030: each ticket's own price (an order's seats may differ in price).
      { kind: 'money', value: t.price },
      text(o.id.slice(0, 8).toUpperCase()),
    ]),
  );

  return {
    title: `Attendees: ${event.name}`,
    subtitle: [
      ...made.lines,
      ...removed,
      `Times are in ${zoneName(zone)} (the venue's time zone).`,
    ],
    madeAt: made.madeAt,
    sheetName: 'Attendees',
    columns: COLUMNS,
    rows,
  };
}
