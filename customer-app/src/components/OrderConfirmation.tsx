import { Link } from 'react-router-dom';
import type { Event, Order } from '@queuepass/shared';
import { seatWithPrice, startedNotice, usd } from '../format';

/**
 * Spec 006 FR-004: what was bought, what it cost, and every ticket code (with its seat, spec 007).
 * Moved out of `GetTickets` by spec 033 (research R8), so the cart confirms the same way. Spec 034
 * FR-012 (research R5): for an order placed at or after its event's start, how long the tickets
 * admit, from the order's own time and the event's, both the Backend's; without the event's
 * details (the cart could not read them), no such line. Spec 038 (FR-022, FR-026): each seated
 * ticket with its seat's labels, level and price; no single price each when they differ.
 */
export function OrderConfirmation({
  eventName,
  order,
  event,
}: {
  eventName: string;
  order: Order;
  event?: Pick<Event, 'startsAt' | 'endsAt' | 'location'> | null;
}) {
  const late = event && Date.parse(order.createdAt) >= Date.parse(event.startsAt);
  return (
    <section aria-label="Order confirmed">
      <h2>Order confirmed</h2>
      {late && (
        <p className="note">
          {startedNotice(
            event.startsAt,
            event.endsAt,
            event.location.timeZone,
            order.createdAt,
            'admit',
          )}
        </p>
      )}
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
        {order.unitPrice !== null && (
          <>
            <dt>Price each</dt>
            <dd>{usd(order.unitPrice)}</dd>
          </>
        )}
        <dt>Total charged</dt>
        <dd>{usd(order.totalPrice)}</dd>
      </dl>
      <h3>Your ticket codes</h3>
      <ul aria-label="Ticket codes">
        {order.tickets.map((t) => (
          <li key={t.id}>
            {t.seat ? `${t.code}, ${seatWithPrice(t.seat, t.levelName, t.price)}` : t.code}
          </li>
        ))}
      </ul>
      <Link to="/my-tickets">See all my tickets</Link>
    </section>
  );
}
