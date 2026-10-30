import {
  DEFAULT_TIME_ZONE,
  toLocalDateTime,
  zoneName,
  type EventSales,
  type SalesReport,
} from '@queuepass/shared';
import { deviceZone, madeLines } from './made';
import type { Cell, ExportColumn, ExportTable } from './table';

const text = (value: string): Cell => ({ kind: 'text', value });
const count = (value: number): Cell => ({ kind: 'count', value });
const money = (value: string): Cell => ({ kind: 'money', value });

const STATUS: Record<EventSales['status'], string> = {
  SCHEDULED: 'Scheduled',
  CANCELLED: 'Cancelled',
};

const COLUMNS: ExportColumn[] = [
  { header: 'Event', kind: 'text', width: 30 },
  { header: 'Venue', kind: 'text', width: 24 },
  { header: 'Starts', kind: 'dateTime', width: 18 },
  { header: 'Time zone', kind: 'text', width: 24 },
  { header: 'Status', kind: 'text', width: 20 },
  { header: 'Tickets sold', kind: 'count', width: 13 },
  { header: 'Ticket capacity', kind: 'count', width: 15 },
  { header: 'Revenue', kind: 'money', width: 14 },
  { header: 'Checked in', kind: 'count', width: 12 },
];

/**
 * Spec 023 FR-005 (data-model.md): one row per event in the page's order, each time in its own
 * venue's zone (R4), then Total with the page's totals. Made at `generatedAt` (R7).
 */
export function salesTable(
  report: SalesReport,
  madeBy: string,
  adminZone: string = deviceZone(),
): ExportTable {
  const made = madeLines(report.generatedAt, madeBy, adminZone);
  const rows = report.events.map((e): Cell[] => {
    const zone = e.timeZone ?? DEFAULT_TIME_ZONE;
    return [
      text(e.name),
      text(e.venueName),
      { kind: 'dateTime', value: toLocalDateTime(e.startsAt, zone) },
      text(zoneName(zone)),
      text(STATUS[e.status]),
      count(e.ticketsSold),
      count(e.ticketCapacity),
      money(e.revenue),
      count(e.checkedIn),
    ];
  });
  const { totals } = report;
  rows.push([
    text('Total'),
    text(''),
    { kind: 'dateTime', value: '' },
    text(''),
    text(`${totals.events} scheduled ${totals.events === 1 ? 'event' : 'events'}`),
    count(totals.ticketsSold),
    count(totals.ticketCapacity),
    money(totals.revenue),
    count(totals.checkedIn),
  ]);

  return {
    title: 'Sales report',
    subtitle: [
      ...made.lines,
      "Each event's time is in its venue's time zone (the Time zone column).",
    ],
    madeAt: made.madeAt,
    sheetName: 'Sales',
    columns: COLUMNS,
    rows,
  };
}
