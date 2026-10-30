import {
  DEFAULT_TIME_ZONE,
  toLocalDateTime,
  zoneName,
  type Event,
  type InstantLike,
  type Order,
  type Ticket,
} from '@queuepass/shared';
import { seatLabel } from '../format';
import { deviceZone, madeLines } from './made';
import type { Cell, ExportColumn, ExportTable } from './table';

const text = (value: string): Cell => ({ kind: 'text', value });
const dateTime = (value: string): Cell => ({ kind: 'dateTime', value });

const TICKET_STATUS: Record<Ticket['status'], string> = { VALID: 'Valid', VOID: 'Void' };
const ORDER_STATUS: Record<Order['status'], string> = {
  CONFIRMED: 'Confirmed',
  REFUNDED: 'Refunded',
};

const COLUMNS: ExportColumn[] = [
  { header: 'Order placed', kind: 'dateTime', width: 18 },
  { header: 'Customer', kind: 'text', width: 16 },
  { header: 'Name on tickets', kind: 'text', width: 24 },
  { header: 'Tier', kind: 'text', width: 18 },
  { header: 'Seat', kind: 'text', width: 26 },
  { header: 'Ticket code', kind: 'text', width: 15, nowrap: true },
  { header: 'Ticket status', kind: 'text', width: 13 },
  { header: 'Checked in', kind: 'dateTime', width: 18 },
  { header: 'Order status', kind: 'text', width: 13 },
  { header: 'Price', kind: 'money', width: 11 },
  { header: 'Order', kind: 'text', width: 11, nowrap: true },
];

/**
 * Spec 023 FR-004 (data-model.md): one row per ticket, carrying its order's details, in the
 * page's order (the Backend's, oldest order first). Every time is in the venue's zone (R4).
 */
export function attendeeTable(
  event: Event,
  orders: Order[],
  madeAt: InstantLike,
  madeBy: string,
  adminZone: string = deviceZone(),
): ExportTable {
  const zone = event.location.timeZone ?? DEFAULT_TIME_ZONE;
  const local = (iso: string | null): Cell => dateTime(iso ? toLocalDateTime(iso, zone) : '');
  const made = madeLines(madeAt, madeBy, adminZone);

  const rows = orders.flatMap((o) =>
    o.tickets.map((t): Cell[] => [
      local(o.createdAt),
      text(o.customerUsername),
      text(o.holderName ?? 'No name on ticket'),
      text(o.tierName ?? 'General admission'),
      text(t.seat ? seatLabel(t.seat) : ''),
      text(t.code),
      text(TICKET_STATUS[t.status]),
      // Research R13b: a void ticket shows no check-in, as the page shows only "(void)".
      local(t.status === 'VOID' ? null : t.checkedInAt),
      text(ORDER_STATUS[o.status]),
      { kind: 'money', value: o.unitPrice },
      text(o.id.slice(0, 8).toUpperCase()),
    ]),
  );

  return {
    title: `Attendees: ${event.name}`,
    subtitle: [...made.lines, `Times are in ${zoneName(zone)} (the venue's time zone).`],
    madeAt: made.madeAt,
    sheetName: 'Attendees',
    columns: COLUMNS,
    rows,
  };
}
