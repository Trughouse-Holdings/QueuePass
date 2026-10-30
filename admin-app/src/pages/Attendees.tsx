import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Event, Order } from '@queuepass/shared';
import { ApiError } from '../api/client';
import { getEvent } from '../api/events';
import { listAttendees } from '../api/orders';
import { seatLabel, when } from '../format';
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
 * Spec 005 US3 (FR-007): who has tickets for an event, every ticket code, and which tickets have
 * been checked in. Refunded orders stay listed, marked as such. Spec 023 US1: Download saves the
 * list as CSV, Excel, or PDF, made from what the page shows; `username` (from `App`'s
 * `useAuth()`, research R13a) is the file's made by.
 */
export function Attendees({ username }: { username?: string }): React.ReactElement {
  const { id = '' } = useParams();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

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
  const makeTable = () => attendeeTable(event, orders, loadedAt, username ?? 'unknown', zone);
  const valid = orders.flatMap((o) => o.tickets).filter((t) => t.status === 'VALID');
  const checkedIn = valid.filter((t) => t.checkedInAt).length;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">Attendees: {event.name}</h1>
          <p className="page-sub">
            {`${orders.length} ${orders.length === 1 ? 'order' : 'orders'} · ${valid.length} valid ${valid.length === 1 ? 'ticket' : 'tickets'} · ${checkedIn} checked in`}
          </p>
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
                  return (
                    <tr key={o.id}>
                      <td className="cell-strong">{o.customerUsername}</td>
                      <td>{o.holderName ?? 'No name on ticket'}</td>
                      <td>{o.tierName ?? 'General admission'}</td>
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
                              {t.seat && ` ${seatLabel(t.seat)}`}
                              {/* Spec 017 FR-020: the time of each entry, from checkedInAt. */}
                              {t.status === 'VOID'
                                ? ' (void)'
                                : t.checkedInAt
                                  ? ` ✓ checked in ${when(t.checkedInAt, load.event.location.timeZone)}`
                                  : ''}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="cell-num">{`${checked} of ${o.tickets.length} checked in`}</td>
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
