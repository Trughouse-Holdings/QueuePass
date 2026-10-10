import { Link, useParams } from 'react-router-dom';
import type { Event } from '@queuepass/shared';
import { ServiceUnreachable } from '@queuepass/shared/web';
import { GetTickets } from '../components/GetTickets';
import { count, usd, when } from '../format';
import { useLoad } from '../use-load';

/**
 * Spec 003 FR-005, US2-4: one event, with a way to its venue. Spec 006: and a way to get tickets,
 * the only write the Customer app makes (FR-009).
 */
export function EventDetail() {
  const { id = '' } = useParams();
  const load = useLoad<Event>(`event:${id}`, (api) =>
    api.GET('/events/{id}', { params: { path: { id } } }),
  );

  if (load.kind === 'loading') return <p>Loading…</p>;
  if (load.kind === 'unreachable') return <ServiceUnreachable />;
  if (load.kind === 'missing') {
    return (
      <section>
        <p>This event is no longer available.</p>
        <Link to="/events">Back to events</Link>
      </section>
    );
  }

  const e = load.data;
  return (
    <section>
      <h1 className="page-title">{e.name}</h1>
      {/* Spec 005 FR-012: a cancelled event stays visible, clearly marked. */}
      {e.status === 'CANCELLED' && (
        <p>
          <strong>This event has been cancelled.</strong>
        </p>
      )}
      <div className="card">
        <dl>
          <dt>Venue</dt>
          <dd>
            <Link to={`/venues/${e.locationId}`}>{e.location.name}</Link>
          </dd>
          <dt>Starts</dt>
          <dd>{when(e.startsAt)}</dd>
          <dt>Ends</dt>
          <dd>{when(e.endsAt)}</dd>
          <dt>Tickets</dt>
          <dd>{count(e.totalTicketCapacity)}</dd>
          <dt>Base price</dt>
          <dd>{usd(e.basePrice)}</dd>
        </dl>
      </div>
      <GetTickets event={e} />
      <Link to="/events">All events</Link>
    </section>
  );
}
