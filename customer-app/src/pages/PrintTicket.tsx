import { Link, useParams } from 'react-router-dom';
import type { MyOrder } from '@queuepass/shared';
import { ServiceUnreachable } from '@queuepass/shared/web';
import { TicketQr } from '../components/TicketQr';
import { seatLabel, when } from '../format';
import { useLoad } from '../use-load';

/**
 * Spec 017 US5 (FR-012, FR-013): one ticket on one printed page — the QR code, the code in text
 * for typing at the gate, the holder's name, the event, venue, start time, and seat. It reads
 * the caller's own orders, so it shows only their tickets. A used or void ticket has no printable
 * view: its link is never offered, and this page refuses a direct visit too.
 */
export function PrintTicket() {
  const { ticketId = '' } = useParams();
  const load = useLoad<MyOrder[]>('my-orders', (api) => api.GET('/me/orders'));

  if (load.kind === 'loading') return <p>Loading…</p>;
  if (load.kind !== 'ok') return <ServiceUnreachable />;

  const order = load.data.find((o) => o.tickets.some((t) => t.id === ticketId));
  const ticket = order?.tickets.find((t) => t.id === ticketId);
  if (!order || !ticket) {
    return (
      <section>
        <p>Ticket not found.</p>
        <Link to="/my-tickets">Back to My tickets</Link>
      </section>
    );
  }
  if (ticket.status !== 'VALID' || ticket.checkedInAt !== null) {
    return (
      <section>
        <p>This ticket can&apos;t be printed.</p>
        <Link to="/my-tickets">Back to My tickets</Link>
      </section>
    );
  }

  return (
    <section className="print-ticket" aria-labelledby="print-ticket-heading">
      <div className="print-ticket__page card card--padded">
        <h1 id="print-ticket-heading">{order.event.name}</h1>
        <TicketQr code={ticket.code} />
        <p className="print-ticket__code">{ticket.code}</p>
        <dl>
          <dt>Name on ticket</dt>
          <dd>{order.holderName ?? 'No name on ticket'}</dd>
          <dt>Venue</dt>
          <dd>{order.event.location.name}</dd>
          <dt>Starts</dt>
          <dd>{when(order.event.startsAt)}</dd>
          {ticket.seat && (
            <>
              <dt>Seat</dt>
              <dd>{seatLabel(ticket.seat)}</dd>
            </>
          )}
        </dl>
        <p className="note">Show this code at the gate with the photo ID named above.</p>
      </div>
      <div className="print-ticket__actions">
        <button type="button" className="btn btn--primary" onClick={() => window.print()}>
          Print
        </button>
        <Link to="/my-tickets">Back to My tickets</Link>
      </div>
    </section>
  );
}
