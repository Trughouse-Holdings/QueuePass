import { Link } from 'react-router-dom';
import type { Event } from '@queuepass/shared';
import { ServiceUnreachable } from '@queuepass/shared/web';
import { usd, when } from '../format';
import { useLoad } from '../use-load';

/**
 * Spec 003 US1 (FR-001, FR-002): every event, in the order the Backend returns them, which is
 * soonest first (research R3). Read-only.
 */
export function EventList() {
  const load = useLoad<Event[]>('events', (api) => api.GET('/events'));

  return (
    <section>
      <h1>Events</h1>
      {load.kind === 'loading' && <p>Loading…</p>}
      {(load.kind === 'unreachable' || load.kind === 'missing') && <ServiceUnreachable />}
      {load.kind === 'ok' &&
        (load.data.length === 0 ? (
          <p>Nothing is scheduled yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Venue</th>
                <th scope="col">Starts</th>
                <th scope="col">Ends</th>
                <th scope="col">Base price</th>
              </tr>
            </thead>
            <tbody>
              {load.data.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link to={`/events/${e.id}`}>{e.name}</Link>
                  </td>
                  <td>
                    <Link to={`/venues/${e.locationId}`}>{e.location.name}</Link>
                  </td>
                  <td>{when(e.startsAt)}</td>
                  <td>{when(e.endsAt)}</td>
                  <td>{usd(e.basePrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </section>
  );
}
