import { Link, useParams } from 'react-router-dom';
import type { Event, Location } from '@queuepass/shared';
import { ServiceUnreachable } from '@queuepass/shared/web';
import { EventCards } from '../components/EventCard';
import { count } from '../format';
import { useLoad } from '../use-load';

/** Spec 003 FR-004: one venue and the events scheduled there, soonest first. Read-only. */
export function VenueDetail() {
  const { id = '' } = useParams();
  const load = useLoad<{ venue: Location; events: Event[] }>(`venue:${id}`, async (api) => {
    const [venue, events] = await Promise.all([
      api.GET('/locations/{id}', { params: { path: { id } } }),
      api.GET('/events', { params: { query: { locationId: id } } }),
    ]);
    // The venue's own answer decides missing or not; then the events must load too.
    const response = venue.response.ok ? events.response : venue.response;
    return {
      response,
      data: venue.data && events.data ? { venue: venue.data, events: events.data } : undefined,
    };
  });

  if (load.kind === 'loading') return <p>Loading…</p>;
  if (load.kind === 'unreachable') return <ServiceUnreachable />;
  if (load.kind === 'missing') {
    return (
      <section>
        <p>This venue is no longer available.</p>
        <Link to="/venues">Back to venues</Link>
      </section>
    );
  }

  const { venue, events } = load.data;
  return (
    <section>
      <h1 className="page-title">{venue.name}</h1>
      <div className="card">
        <dl>
          <dt>Address</dt>
          <dd>{venue.address}</dd>
          <dt>Seating capacity</dt>
          <dd>{count(venue.seatingCapacity)}</dd>
        </dl>
      </div>

      <h2>Events here</h2>
      {events.length === 0 ? (
        <p>Nothing is scheduled here.</p>
      ) : (
        <EventCards events={events} label={`Events at ${venue.name}`} />
      )}
      <Link to="/venues">All venues</Link>
    </section>
  );
}
