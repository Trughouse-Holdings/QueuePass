import { Link } from 'react-router-dom';
import type { Location } from '@queuepass/shared';
import { ServiceUnreachable } from '@queuepass/shared/web';
import { count } from '../format';
import { useLoad } from '../use-load';

/**
 * Spec 003 US2 (FR-003): every venue, in the order the Backend returns them, which is by name
 * (research R3). Read-only.
 */
export function VenueList() {
  const load = useLoad<Location[]>('venues', (api) => api.GET('/locations'));

  return (
    <section>
      <h1>Venues</h1>
      {load.kind === 'loading' && <p>Loading…</p>}
      {(load.kind === 'unreachable' || load.kind === 'missing') && <ServiceUnreachable />}
      {load.kind === 'ok' &&
        (load.data.length === 0 ? (
          <p>No venues yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Venue</th>
                <th scope="col">Address</th>
                <th scope="col">Seating capacity</th>
              </tr>
            </thead>
            <tbody>
              {load.data.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link to={`/venues/${v.id}`}>{v.name}</Link>
                  </td>
                  <td>{v.address}</td>
                  <td>{count(v.seatingCapacity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </section>
  );
}
