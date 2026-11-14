import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Event, LayoutSummary, Location } from '@queuepass/shared';
import { AddressLink } from '@queuepass/shared/web';
import { ApiError } from '../api/client';
import { deleteLocation, getLocation } from '../api/locations';
import { listEvents } from '../api/events';
import { ErrorBanner } from '../components/ErrorBanner';
import { LayoutsCard } from '../components/LayoutsCard';
import { hasEnded, venueZone, when } from '../format';
import { useDelete } from '../hooks/use-delete';

type Load =
  | { kind: 'loading' }
  | { kind: 'ok'; venue: Location; events: Event[]; loadedAt: number }
  | { kind: 'missing' }
  | { kind: 'unreachable' };

/**
 * Spec 002 FR-024, US1-2: one venue, the events scheduled there, and Edit and Delete. Delete
 * lives here rather than in list rows, where the admin can see what it would affect (research R3).
 * Spec 030 FR-008, FR-009 (research R5): its own Show past events, kept in its address as `past=1`.
 */
export function LocationDetail(): React.ReactElement {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const past = params.get('past') === '1';
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  const showPast = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set('past', '1');
    else next.delete('past');
    setParams(next);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([getLocation(id), listEvents({ locationId: id, includePast: past })])
      .then(
        ([venue, events]) =>
          // Spec 030 FR-012 (research R6): the time is read when the events arrive.
          !cancelled && setLoad({ kind: 'ok', venue, events, loadedAt: Date.now() }),
      )
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
  }, [id, past]);

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
  return (
    <VenueView
      venue={load.venue}
      events={load.events}
      loadedAt={load.loadedAt}
      past={past}
      onPast={showPast}
    />
  );
}

function VenueView({
  venue,
  events,
  loadedAt,
  past,
  onPast,
}: {
  venue: Location;
  events: Event[];
  loadedAt: number;
  past: boolean;
  onPast: (on: boolean) => void;
}): React.ReactElement {
  // Spec 038 FR-009: while the venue has layouts, its capacity is its largest layout's.
  const [layouts, setLayouts] = useState<LayoutSummary[]>([]);
  const largest = layouts.length > 0 ? Math.max(...layouts.map((l) => l.seatCount)) : null;
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
          {/* Spec 020 FR-024 (research R14). */}
          <p className="note">{`Time zone: ${venueZone(venue)}.`}</p>
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
          <span className="cell-num">{(largest ?? venue.seatingCapacity).toLocaleString()}</span>
        </p>
        {largest !== null && (
          <p className="note">{`From the largest layout (${largest.toLocaleString()} seats)`}</p>
        )}

        <h2>Events here</h2>
        <label className="choice">
          <input type="checkbox" checked={past} onChange={(e) => onPast(e.target.checked)} />
          Show past events
        </label>
        {/* Spec 030 FR-009: said while the toggle is off, also when nothing is listed. */}
        {!past && <p className="note">Past events are hidden.</p>}
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
                      </Link>{' '}
                      {e.status === 'CANCELLED' && (
                        <span className="pill pill--danger">Cancelled</span>
                      )}{' '}
                      {/* Spec 030 FR-011 (research R6): in text, after Cancelled when both. */}
                      {hasEnded(e.endsAt, loadedAt) && <span className="pill">Ended</span>}
                    </td>
                    <td className="cell-time">
                      {when(e.startsAt, e.location?.timeZone ?? venue.timeZone)}
                    </td>
                    <td className="cell-time">
                      {when(e.endsAt, e.location?.timeZone ?? venue.timeZone)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LayoutsCard venue={venue} events={events} onLayouts={setLayouts} />
    </section>
  );
}
