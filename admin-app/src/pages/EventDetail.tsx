import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Event } from '@queuepass/shared';
import { ApiError } from '../api/client';
import { deleteEvent, getEvent } from '../api/events';
import { cancelEvent } from '../api/orders';
import { ErrorBanner } from '../components/ErrorBanner';
import { SalesCard } from '../components/SalesCard';
import { SeatingCard } from '../components/SeatingCard';
import { SuccessState } from '../components/SuccessState';
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
  return <EventView event={load.event} onChange={(event) => setLoad({ kind: 'ok', event })} />;
}

function EventView({
  event,
  onChange,
}: {
  event: Event;
  onChange: (event: Event) => void;
}): React.ReactElement {
  const cancelled = event.status === 'CANCELLED';
  const cancel = useCancel(event, onChange);
  // Spec 007 (revision R11): seating sets the event's capacity and its tiers' amounts, and the
  // Seating card maps the tiers, so each card reloads when the other changes.
  const [tiersVersion, setTiersVersion] = useState(0);
  const [seatingVersion, setSeatingVersion] = useState(0);
  const seatingSaved = (): void => {
    setTiersVersion((v) => v + 1);
    void getEvent(event.id)
      .then(onChange)
      .catch(() => undefined);
  };
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
          <h1 className="page-title">
            {event.name} {cancelled && <span className="pill">Cancelled</span>}
          </h1>
        </div>
        <div className="form__actions">
          <Link to={`/events/${event.id}/attendees`} className="btn">
            Attendees
          </Link>
          {!cancelled && (
            <>
              <Link to={`/events/${event.id}/edit`} className="btn">
                Edit
              </Link>
              <button
                type="button"
                className="btn"
                onClick={() => void cancel.run()}
                disabled={cancel.busy}
              >
                {cancel.busy ? 'Cancelling…' : 'Cancel event'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void remove()}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </>
          )}
        </div>
      </div>

      {cancel.done && <SuccessState message={cancel.done} />}
      {cancel.error && <ErrorBanner error={cancel.error} title="Could not cancel" />}
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

      {/* Keyed on status: cancelling refunds every sale, so the card must reload. */}
      <SalesCard key={event.status} eventId={event.id} />
      <TierSection
        key={`tiers-${tiersVersion}`}
        event={event}
        readOnly={cancelled}
        onChange={() => setSeatingVersion((v) => v + 1)}
      />
      {/* Spec 007: hidden once cancelled, as the tier form's controls are. */}
      {!cancelled && (
        <SeatingCard key={`seating-${seatingVersion}`} event={event} onSaved={seatingSaved} />
      )}
    </section>
  );
}

/**
 * Spec 005 FR-008: confirm, cancel, then show the counts and switch the page to read-only.
 * Cancelling is irreversible, so nothing is sent unless the admin confirms.
 */
function useCancel(
  event: Event,
  onChange: (event: Event) => void,
): { run: () => Promise<void>; busy: boolean; done: string | null; error: ApiError | null } {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const inFlight = useRef(false);

  const run = async () => {
    if (inFlight.current) return;
    const ok = window.confirm(
      `Cancel "${event.name}"? Every ticket will be voided and every order refunded. This cannot be undone.`,
    );
    if (!ok) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await cancelEvent(event.id);
      setDone(
        `Cancelled. ${result.ordersRefunded} ${result.ordersRefunded === 1 ? 'order' : 'orders'} refunded, ` +
          `${result.ticketsVoided} ${result.ticketsVoided === 1 ? 'ticket' : 'tickets'} voided.`,
      );
      onChange(result.event);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new ApiError(0, {
              error: { code: 'VALIDATION_FAILED', message: "Can't reach the QueuePass service." },
            }),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { run, busy, done, error };
}
