import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Event, Order, Ticket } from '@queuepass/shared';
import { ApiError } from '../api/client';
import { getEvent } from '../api/events';
import { listAttendees } from '../api/orders';
import { getSalesReport } from '../api/reports';
import { removedNote, seatLabel, when } from '../format';
import { usd } from '../money';
import { attendeeTable } from '../export/attendee-rows';
import { ExportMenu } from '../export/ExportMenu';
import { fileName } from '../export/file-name';
import { deviceZone } from '../export/made';

type Load =
  | { kind: 'loading' }
  /** Spec 023 FR-003: `loadedAt` is when the answer arrived, every file's made-at time. */
  | { kind: 'ok'; event: Event; orders: Order[]; loadedAt: number }
  | { kind: 'missing' }
  | { kind: 'unreachable' };

const STATUS: Record<Order['status'], string> = { CONFIRMED: 'Confirmed', REFUNDED: 'Refunded' };

const PRIVATE_NOTE = "The file contains customers' names and usernames. Keep it private.";

/**
 * After a ticket's code (spec 038 FR-026, FR-030): its seat by its labels, its price level, and
 * its own price, which the order's unit price does not give for a seated ticket or an order of
 * several prices: " Section 115, Row F, Seat 7, Lower sideline, $60.00".
 */
function ticketDetails(t: Ticket, unitPrice: string | null): string {
  const parts = [
    ...(t.seat ? [seatLabel(t.seat)] : []),
    ...(t.levelName ? [t.levelName] : []),
    ...(t.seat || t.levelName || unitPrice === null ? [usd(t.price)] : []),
  ];
  return parts.length > 0 ? ` ${parts.join(', ')}` : '';
}

/**
 * Spec 005 US3 (FR-007): who has tickets for an event, every ticket code, and which tickets have
 * been checked in. Refunded orders stay listed, marked as such. Spec 023 US1: Download saves the
 * list as CSV, Excel, or PDF, made from what the page shows; `username` (from `App`'s
 * `useAuth()`, research R13a) is the file's made by.
 */
export function Attendees({ username }: { username?: string }): React.ReactElement {
  const { id = '' } = useParams();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  /**
   * Spec 032 FR-010 (research R7): a removed event's checked-in count, kept in the admin-only
   * sales report; read only for a removed event, `null` until it arrives or when it fails.
   */
  const [kept, setKept] = useState<number | null>(null);
  const removedAt = load.kind === 'ok' ? (load.event.checkInDetailsRemovedAt ?? null) : null;

  useEffect(() => {
    // Review round 1: another event's count is never shown or exported for this one.
    setKept(null);
    if (!removedAt) return;
    let cancelled = false;
    getSalesReport()
      .then((r) => {
        const row = r.events.find((e) => e.eventId === id);
        if (!cancelled && row) setKept(row.checkedIn);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, removedAt]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getEvent(id), listAttendees(id)])
      .then(
        ([event, orders]) =>
          !cancelled && setLoad({ kind: 'ok', event, orders, loadedAt: Date.now() }),
      )
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoad(
          err instanceof ApiError && err.status === 404
            ? { kind: 'missing' }
            : { kind: 'unreachable' },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (load.kind === 'loading') return <p className="loading">Loading attendees…</p>;
  if (load.kind === 'unreachable')
    return (
      <p role="alert" className="banner banner--error">
        Can&apos;t reach the QueuePass service.
      </p>
    );
  if (load.kind === 'missing') {
    return (
      <section>
        <p>This event no longer exists.</p>
        <Link to="/events" className="btn">
          Back to events
        </Link>
      </section>
    );
  }

  const { event, orders, loadedAt } = load;
  // Spec 023 FR-012: one zone for the made-at time and the file name, the admin's own.
  const zone = deviceZone();
  const makeTable = () =>
    attendeeTable(event, orders, loadedAt, username ?? 'unknown', zone, removedAt ? kept : null);
  const valid = orders.flatMap((o) => o.tickets).filter((t) => t.status === 'VALID');
  // Spec 032 FR-010: once removed, the kept count, or no checked-in part while it is not known.
  const checkedIn = removedAt ? kept : valid.filter((t) => t.checkedInAt).length;
  const summary = [
    `${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`,
    `${valid.length} valid ${valid.length === 1 ? 'ticket' : 'tickets'}`,
    ...(checkedIn === null ? [] : [`${checkedIn} checked in`]),
  ].join(' · ');

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">Attendees: {event.name}</h1>
          <p className="page-sub">{summary}</p>
          {removedAt && <p className="note">{removedNote(removedAt, event.location.timeZone)}</p>}
        </div>
        <div className="form__actions">
          {/* Spec 023 FR-001, FR-011: only when there is at least one order. */}
          {orders.length > 0 && (
            <ExportMenu
              label="Download the attendee list"
              makeTable={makeTable}
              fileName={(ext) =>
                fileName('attendees', event.name, new Date(loadedAt).toISOString(), zone, ext)
              }
              note={PRIVATE_NOTE}
            />
          )}
          <Link to={`/events/${event.id}`} className="btn">
            Back to {event.name}
          </Link>
        </div>
      </div>

      <div className="card">
        {orders.length === 0 ? (
          <p className="note">No one has tickets for this event yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  {/* Spec 017 FR-004: the name the gate checks an ID against. */}
                  <th>Name on tickets</th>
                  <th>Tier</th>
                  {/* Spec 038 FR-030 (research R17): beside the ticket type. */}
                  <th>Price level</th>
                  <th>Tickets</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Ticket codes</th>
                  <th>Check-in</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const checked = o.tickets.filter((t) => t.checkedInAt).length;
                  const levels = [
                    ...new Set(o.tickets.flatMap((t) => (t.levelName ? [t.levelName] : []))),
                  ];
                  const seated = o.tickets.some((t) => t.seat || t.levelName);
                  return (
                    <tr key={o.id}>
                      <td className="cell-strong">{o.customerUsername}</td>
                      <td>{o.holderName ?? 'No name on ticket'}</td>
                      {/* A seat is never general admission (spec 038 FR-030). */}
                      <td>{o.tierName ?? (seated ? '' : 'General admission')}</td>
                      <td>{levels.join(', ')}</td>
                      <td className="cell-num">{o.quantity}</td>
                      <td className="price">{usd(o.totalPrice)}</td>
                      <td>
                        <span className="pill">{STATUS[o.status]}</span>
                      </td>
                      <td>
                        <ul>
                          {o.tickets.map((t) => (
                            <li key={t.id}>
                              <code>{t.code}</code>
                              {ticketDetails(t, o.unitPrice)}
                              {/* Spec 017 FR-020: the time of each entry, from checkedInAt. */}
                              {t.status === 'VOID'
                                ? ' (void)'
                                : t.checkedInAt && !removedAt
                                  ? ` ✓ checked in ${when(t.checkedInAt, load.event.location.timeZone)}`
                                  : ''}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="cell-num">
                        {removedAt ? '—' : `${checked} of ${o.tickets.length} checked in`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
