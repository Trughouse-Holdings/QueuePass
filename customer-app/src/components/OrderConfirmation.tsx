import { Link } from 'react-router-dom';
import type { Order } from '@queuepass/shared';
import { seatLabel, usd } from '../format';

/**
 * Spec 006 FR-004: what was bought, what it cost, and every ticket code (with its seat, spec 007).
 * Moved out of `GetTickets` by spec 033 (research R8), so the cart confirms the same way.
 */
export function OrderConfirmation({ eventName, order }: { eventName: string; order: Order }) {
  return (
    <section aria-label="Order confirmed">
      <h2>Order confirmed</h2>
      <dl>
        <dt>Event</dt>
        <dd>{eventName}</dd>
        {order.tierName && (
          <>
            <dt>Tier</dt>
            <dd>{order.tierName}</dd>
          </>
        )}
        <dt>Quantity</dt>
        <dd>{order.quantity}</dd>
        <dt>Price each</dt>
        <dd>{usd(order.unitPrice)}</dd>
        <dt>Total charged</dt>
        <dd>{usd(order.totalPrice)}</dd>
      </dl>
      <h3>Your ticket codes</h3>
      <ul aria-label="Ticket codes">
        {order.tickets.map((t) => (
          <li key={t.id}>{t.seat ? `${t.code}, ${seatLabel(t.seat)}` : t.code}</li>
        ))}
      </ul>
      <Link to="/my-tickets">See all my tickets</Link>
    </section>
  );
}
