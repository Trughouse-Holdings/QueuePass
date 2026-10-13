import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Event, Location } from '@queuepass/shared';
import { AddressLink } from '@queuepass/shared/web';
import { ApiError } from '../api/client';
import { deleteLocation, getLocation } from '../api/locations';
import { listEvents } from '../api/events';
import { ErrorBanner } from '../components/ErrorBanner';
import { LayoutCard } from '../components/LayoutCard';
import { when } from '../format';
import { useDelete } from '../hooks/use-delete';

type Load =
  | { kind: 'loading' }
  | { kind: 'ok'; venue: Location; events: Event[] }
  | { kind: 'missing' }
  | { kind: 'unreachable' };

/**
 * Spec 002 FR-024, US1-2: one venue, the events scheduled there, and Edit and Delete. Delete
 * lives here rather than in list rows, where the admin can see what it would affect (research R3).
 */
export function LocationDetail(): React.ReactElement {
  const { id = '' } = useParams();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([getLocation(id), listEvents({ locationId: id })])
      .then(([venue, events]) => !cancelled && setLoad({ kind: 'ok', venue, events }))
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

  if (load.kind === 'loading') return <p className="loading">Loading venue…</p>;
  if (load.kind === 'unreachable')
    return (
      <p role="alert" className="banner banner--error">
        Can&apos;t reach the QueuePass service.
      </p>
    );
  if (load.kind === 'missing') {
    return (
      <section>
        <p>This venue no longer exists.</p>
        <Link to="/locations" className="btn">
          Back to venues
        </Link>
      </section>
    );
  }
  return <VenueView venue={load.venue} events={load.events} />;
}

function VenueView({ venue, events }: { venue: Location; events: Event[] }): React.ReactElement {
  const { remove, deleting, error } = useDelete({
    kind: 'venue',
    name: venue.name,
    run: () => deleteLocation(venue.id),
    listPath: '/locations',
  });

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">{venue.name}</h1>
          <p className="page-sub">
            <AddressLink address={venue.address} />
          </p>
          {/* Spec 013 FR-017. */}
          {!venue.addressVerified && (
            <p className="note">Address not verified. Edit the venue to verify it.</p>
          )}
        </div>
        <div className="form__actions">
          <Link to={`/locations/${venue.id}/edit`} className="btn">
            Edit
          </Link>
          <button type="button" className="btn" onClick={() => void remove()} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {error && <ErrorBanner error={error} title="Could not delete" />}

      <div className="card">
        <p>
          Seating capacity:{' '}
          <span className="cell-num">{venue.seatingCapacity.toLocaleString()}</span>
        </p>

        <h2>Events here</h2>
        {events.length === 0 ? (
          <p className="note">Nothing is scheduled here.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Starts</th>
                  <th>Ends</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="cell-strong">
                      <Link to={`/events/${e.id}`} className="rowlink">
                        {e.name}
                      </Link>
                    </td>
                    <td className="cell-time">{when(e.startsAt)}</td>
                    <td className="cell-time">{when(e.endsAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LayoutCard venue={venue} />
    </section>
  );
}
