import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Event } from '@queuepass/shared';
import { ApiError } from '../api/client';
import { deleteEvent, getEvent } from '../api/events';
import { ErrorBanner } from '../components/ErrorBanner';
import { TierSection } from '../components/TierSection';
import { when } from '../format';
import { useDelete } from '../hooks/use-delete';

type Load =
  | { kind: 'loading' }
  | { kind: 'ok'; event: Event }
  | { kind: 'missing' }
  | { kind: 'unreachable' };

/**
 * Spec 002 FR-025, FR-031: one event, with its venue, both times dated in the admin's zone, and
 * Edit and Delete. Deleting frees the event's window at the venue (FR-010).
 */
export function EventDetail(): React.ReactElement {
  const { id = '' } = useParams();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getEvent(id)
      .then((event) => !cancelled && setLoad({ kind: 'ok', event }))
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

  if (load.kind === 'loading') return <p className="loading">Loading event…</p>;
  if (load.kind === 'unreachable')
    return <p role="alert">Can&apos;t reach the QueuePass service.</p>;
  if (load.kind === 'missing') {
    return (
      <section>
        <p>This event no longer exists.</p>
        <Link to="/events" className="btn">
          Back to events
        </Link>
      </section>
    );
  }
  return <EventView event={load.event} />;
}

function EventView({ event }: { event: Event }): React.ReactElement {
  const { remove, deleting, error } = useDelete({
    kind: 'event',
    name: event.name,
    run: () => deleteEvent(event.id),
    listPath: '/events',
  });

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">{event.name}</h1>
        </div>
        <div className="form__actions">
          <Link to={`/events/${event.id}/edit`} className="btn">
            Edit
          </Link>
          <button type="button" className="btn" onClick={() => void remove()} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {error && <ErrorBanner error={error} title="Could not delete" />}

      <div className="card">
        <dl>
          <dt>Venue</dt>
          <dd>
            <Link to={`/locations/${event.locationId}`} className="rowlink">
              {event.location.name}
            </Link>
          </dd>
          <dt>Starts</dt>
          <dd className="cell-time">{when(event.startsAt)}</dd>
          <dt>Ends</dt>
          <dd className="cell-time">{when(event.endsAt)}</dd>
          <dt>Tickets</dt>
          <dd className="cell-num">{event.totalTicketCapacity.toLocaleString()}</dd>
          <dt>Base price</dt>
          <dd className="price">${event.basePrice}</dd>
        </dl>
      </div>

      <TierSection event={event} />
    </section>
  );
}
