import { Link } from 'react-router-dom';
import type { MyOrder, Ticket } from '@queuepass/shared';
import { ServiceUnreachable } from '@queuepass/shared/web';
import { calendarEligible } from '../calendar';
import { AddToCalendar } from '../components/AddToCalendar';
import { seatLabel, usd, when } from '../format';
import { useLoad } from '../use-load';

/** The orders, and when they arrived: spec 019 FR-002 decides eligibility at that moment. */
interface Loaded {
  orders: MyOrder[];
  loadedAt: number;
}

/**
 * Spec 006 US3 (FR-008): every order the signed-in customer placed, newest first, with each
 * ticket's code and state. The Backend returns only the caller's own orders (FR-007).
 */
export function MyTickets() {
  // Spec 019 research R10: Date.now() is read once, when the orders load, and kept with them, so
  // a later render does not re-decide which cards offer Add to calendar.
  const load = useLoad<Loaded>('my-orders', async (api) => {
    const { data, response } = await api.GET('/me/orders');
    return { response, data: data && { orders: data, loadedAt: Date.now() } };
  });

  if (load.kind === 'loading') return <p>Loading…</p>;
  if (load.kind !== 'ok') return <ServiceUnreachable />;

  return (
    <section>
      <h1 className="page-title">My tickets</h1>
      {load.data.orders.length === 0 ? (
        <p>
          You have no tickets yet. <Link to="/events">Browse events</Link>
        </p>
      ) : (
        load.data.orders.map((o) => (
          <OrderCard key={o.id} order={o} loadedAt={load.data.loadedAt} />
        ))
      )}
    </section>
  );
}

function OrderCard({ order: o, loadedAt }: { order: MyOrder; loadedAt: number }) {
  return (
    <article className="card card--padded order-card" aria-labelledby={`order-${o.id}`}>
      <h2 id={`order-${o.id}`}>
        <Link to={`/events/${o.event.id}`}>{o.event.name}</Link>
      </h2>
      {o.event.status === 'CANCELLED' && (
        <p>
          <strong>This event has been cancelled.</strong>
        </p>
      )}
      <dl>
        <dt>Venue</dt>
        <dd>{o.event.location.name}</dd>
        <dt>Starts</dt>
        <dd>{when(o.event.startsAt, o.event.location.timeZone)}</dd>
        {o.tierName && (
          <>
            <dt>Tier</dt>
            <dd>{o.tierName}</dd>
          </>
        )}
        {/* Spec 017 FR-004, FR-005: the holder's name, or plainly no name for older orders. */}
        <dt>Name on tickets</dt>
        <dd>{o.holderName ?? 'No name on ticket'}</dd>
        <dt>Quantity</dt>
        <dd>{o.quantity}</dd>
        <dt>Total</dt>
        <dd>{usd(o.totalPrice)}</dd>
        <dt>Placed</dt>
        <dd>{when(o.createdAt, o.event.location.timeZone)}</dd>
        <dt>Status</dt>
        <dd>{o.status === 'REFUNDED' ? 'Refunded' : 'Confirmed'}</dd>
      </dl>
      {/* Spec 019 FR-001, FR-002, FR-015: only on eligible cards; others are unchanged. */}
      {calendarEligible(o, loadedAt) && <AddToCalendar order={o} />}
      <ul aria-label="Tickets" className="ticket-list">
        {o.tickets.map((t) => (
          <li key={t.id}>
            {`${t.seat ? `${t.code}, ${seatLabel(t.seat)}` : t.code}: ${ticketState(t, o.event.location.timeZone)}`}
            {/* Spec 017 FR-012 and spec 018 FR-001: for each valid, unused ticket, a printable
                view and its live entry code. */}
            {t.status === 'VALID' && t.checkedInAt === null && (
              <>
                {' '}
                <Link
                  to={`/my-tickets/${t.id}/entry-code`}
                  aria-label={`Show entry code for ticket ${t.code}`}
                >
                  Show entry code
                </Link>{' '}
                <Link to={`/my-tickets/${t.id}/print`} aria-label={`Print ticket ${t.code}`}>
                  Print ticket
                </Link>
              </>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}

/** Spec 020 FR-021: the time a ticket was used belongs to its event: the venue's zone. */
const ticketState = (t: Ticket, timeZone?: string): string =>
  t.status === 'VOID' ? 'Void' : t.checkedInAt ? `Used ${when(t.checkedInAt, timeZone)}` : 'Valid';
