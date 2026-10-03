import { Link } from 'react-router-dom';
import type { MyOrder, Ticket } from '@queuepass/shared';
import { ServiceUnreachable } from '@queuepass/shared/web';
import { seatLabel, usd, when } from '../format';
import { useLoad } from '../use-load';

/**
 * Spec 006 US3 (FR-008): every order the signed-in customer placed, newest first, with each
 * ticket's code and state. The Backend returns only the caller's own orders (FR-007).
 */
export function MyTickets() {
  const load = useLoad<MyOrder[]>('my-orders', (api) => api.GET('/me/orders'));

  if (load.kind === 'loading') return <p>Loading…</p>;
  if (load.kind !== 'ok') return <ServiceUnreachable />;

  return (
    <section>
      <h1>My tickets</h1>
      {load.data.length === 0 ? (
        <p>
          You have no tickets yet. <Link to="/events">Browse events</Link>
        </p>
      ) : (
        load.data.map((o) => <OrderCard key={o.id} order={o} />)
      )}
    </section>
  );
}

function OrderCard({ order: o }: { order: MyOrder }) {
  return (
    <article aria-labelledby={`order-${o.id}`}>
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
        <dd>{when(o.event.startsAt)}</dd>
        {o.tierName && (
          <>
            <dt>Tier</dt>
            <dd>{o.tierName}</dd>
          </>
        )}
        <dt>Quantity</dt>
        <dd>{o.quantity}</dd>
        <dt>Total</dt>
        <dd>{usd(o.totalPrice)}</dd>
        <dt>Placed</dt>
        <dd>{when(o.createdAt)}</dd>
        <dt>Status</dt>
        <dd>{o.status === 'REFUNDED' ? 'Refunded' : 'Confirmed'}</dd>
      </dl>
      <ul aria-label="Tickets">
        {o.tickets.map((t) => (
          <li key={t.id}>
            {`${t.seat ? `${t.code}, ${seatLabel(t.seat)}` : t.code}: ${ticketState(t)}`}
          </li>
        ))}
      </ul>
    </article>
  );
}

const ticketState = (t: Ticket): string =>
  t.status === 'VOID' ? 'Void' : t.checkedInAt ? `Used ${when(t.checkedInAt)}` : 'Valid';
