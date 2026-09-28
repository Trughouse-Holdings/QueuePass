import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Location, ConflictingEventRef } from '@queuepass/shared';
import { createEvent, getEvent, updateEvent } from '../api/events';
import { listLocations } from '../api/locations';
import { ApiError } from '../api/client';
import { ErrorBanner } from '../components/ErrorBanner';
import { SuccessState } from '../components/SuccessState';

/** `datetime-local` value ("2026-10-01T18:00") → ISO-8601 with the browser's offset. */
const toIso = (local: string): string => new Date(local).toISOString();

/** ISO-8601 → `datetime-local` value in the browser's zone. */
const toLocalInput = (iso: string): string => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** FR-032, FR-033, FR-034, FR-035 — create/edit an event. No removal control (API-only). */
export function EventForm(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [venues, setVenues] = useState<Location[]>([]);
  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [totalTicketCapacity, setTotalTicketCapacity] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listLocations()
      .then(setVenues)
      .catch(() => setVenues([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    getEvent(id)
      .then((e) => {
        setName(e.name);
        setLocationId(e.locationId);
        setStartsAt(toLocalInput(e.startsAt));
        setEndsAt(toLocalInput(e.endsAt));
        setTotalTicketCapacity(String(e.totalTicketCapacity));
        setBasePrice(e.basePrice);
      })
      .catch((err: ApiError) => setError(err));
  }, [id]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);

    const payload = {
      name,
      locationId,
      startsAt: toIso(startsAt),
      endsAt: toIso(endsAt),
      totalTicketCapacity: Number(totalTicketCapacity),
      basePrice,
    };

    try {
      if (isEdit && id) await updateEvent(id, payload);
      else await createEvent(payload);
      setSaved(true);
      setTimeout(() => navigate('/events'), 700);
    } catch (err) {
      // FR-035: state is deliberately untouched here — re-entering a whole form to fix
      // one time is exactly the friction this requirement exists to prevent.
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const conflict =
    error?.code === 'SCHEDULING_CONFLICT'
      ? ((error.details?.conflictingEvent ?? null) as ConflictingEventRef | null)
      : null;

  const selected = venues.find((v) => v.id === locationId);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">{isEdit ? 'Edit event' : 'Schedule event'}</h1>
          <p className="page-sub">Events at the same venue must be at least 60 minutes apart.</p>
        </div>
      </div>

      {saved && <SuccessState message="Event saved." />}
      {error && <ErrorBanner error={error} />}

      {conflict && (
        <p data-testid="conflict-detail" className="conflict-detail">
          Conflicts with <strong>{conflict.name}</strong>, which runs {when(conflict.startsAt)} –{' '}
          {when(conflict.endsAt)}. Pick a slot at least 60 minutes clear of it, or choose another
          venue.
        </p>
      )}

      <div className="card">
        <form className="form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">Event name</label>
            <input
              id="name"
              value={name}
              placeholder="Season Opener"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="locationId">Venue</label>
            <select
              id="locationId"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Select a venue…</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.seatingCapacity.toLocaleString()} seats)
                </option>
              ))}
            </select>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="startsAt">Starts</label>
              <input
                id="startsAt"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="endsAt">Ends</label>
              <input
                id="endsAt"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="totalTicketCapacity">Total tickets</label>
              <input
                id="totalTicketCapacity"
                type="number"
                min={1}
                value={totalTicketCapacity}
                placeholder="18000"
                onChange={(e) => setTotalTicketCapacity(e.target.value)}
              />
              {selected && (
                <span className="field__hint">
                  Up to {selected.seatingCapacity.toLocaleString()} at {selected.name}.
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="basePrice">Base price</label>
              <input
                id="basePrice"
                inputMode="decimal"
                placeholder="45.00"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
              />
            </div>
          </div>

          <div className="form__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Schedule event'}
            </button>
            <Link to="/events" className="btn btn--ghost">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}
