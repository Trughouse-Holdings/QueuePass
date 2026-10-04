import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Location, ConflictingEventRef, SeatingLayout } from '@queuepass/shared';
import { createEvent, getEvent, updateEvent } from '../api/events';
import { listLocations } from '../api/locations';
import { getLayout, updateSeating } from '../api/seating';
import { createTier } from '../api/tiers';
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

/** One ticket type being set up while scheduling (spec 008 US6). */
type TicketType = { name: string; price: string };

const validationError = (message: string): ApiError =>
  new ApiError(400, { error: { code: 'VALIDATION_FAILED', message } });

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
  // Spec 007 FR-018: a seated event's capacity is its venue's layout total.
  const [seated, setSeated] = useState(false);
  const [basePrice, setBasePrice] = useState('');
  // Spec 008 US6 (research R9): at a venue with a layout, set up seating while scheduling.
  const [layout, setLayout] = useState<SeatingLayout | null>(null);
  const [plan, setPlan] = useState<'reserved' | 'general'>('reserved');
  const [types, setTypes] = useState<TicketType[]>([{ name: '', price: '' }]);
  /** Each section's ticket type, as an index into `types`; '' is Not for sale. */
  const [sectionType, setSectionType] = useState<Record<string, string>>({});
  const [setupRefused, setSetupRefused] = useState<{ eventId: string; error: ApiError } | null>(
    null,
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listLocations()
      .then(setVenues)
      .catch(() => setVenues([]));
  }, []);

  useEffect(() => {
    setLayout(null);
    if (id || !locationId) return;
    let cancelled = false;
    getLayout(locationId)
      .then((l) => {
        if (cancelled) return;
        setLayout(l.sections.length > 0 ? l : null);
        // Every section sells the first ticket type until the admin says otherwise.
        setSectionType(Object.fromEntries(l.sections.map((s) => [s.id, '0'])));
      })
      .catch(() => !cancelled && setLayout(null));
    return () => {
      cancelled = true;
    };
  }, [id, locationId]);

  useEffect(() => {
    if (!id) return;
    getEvent(id)
      .then((e) => {
        setName(e.name);
        setLocationId(e.locationId);
        setStartsAt(toLocalInput(e.startsAt));
        setEndsAt(toLocalInput(e.endsAt));
        setTotalTicketCapacity(String(e.totalTicketCapacity));
        setSeated(e.reservedSeating);
        setBasePrice(e.basePrice);
      })
      .catch((err: ApiError) => setError(err));
  }, [id]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSetupRefused(null);
    setSaved(false);

    const reserved = !isEdit && layout !== null && plan === 'reserved';
    if (reserved && types.some((t) => !t.name.trim() || !t.price.trim())) {
      setError(validationError('Give every ticket type a name and a price.'));
      return;
    }
    setBusy(true);

    const payload = {
      name,
      locationId,
      startsAt: toIso(startsAt),
      endsAt: toIso(endsAt),
      // FR-019: blank means the venue's capacity; seated events never send one (FR-018).
      ...(!seated && !reserved && totalTicketCapacity.trim() !== ''
        ? { totalTicketCapacity: Number(totalTicketCapacity) }
        : {}),
      basePrice,
    };

    try {
      if (isEdit && id) await updateEvent(id, payload);
      else {
        const created = await createEvent(payload);
        if (reserved && layout) {
          // Spec 008 R9: the event exists now; finish its seating with the existing operations.
          try {
            await updateSeating(created.id, { reservedSeating: true, sections: [] });
            const tierIds: string[] = [];
            for (const t of types) {
              tierIds.push(
                (await createTier(created.id, { name: t.name.trim(), price: t.price.trim() })).id,
              );
            }
            await updateSeating(created.id, {
              reservedSeating: true,
              sections: layout.sections
                .filter((sec) => sectionType[sec.id] !== '' && tierIds[Number(sectionType[sec.id])])
                .map((sec) => ({
                  sectionId: sec.id,
                  tierId: tierIds[Number(sectionType[sec.id])],
                })),
            });
          } catch (err) {
            setSetupRefused({ eventId: created.id, error: err as ApiError });
            return;
          }
          navigate(`/events/${created.id}`);
          return;
        }
      }
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

  const setType = (i: number, change: Partial<TicketType>) =>
    setTypes(types.map((t, j) => (j === i ? { ...t, ...change } : t)));
  const removeType = (i: number) => {
    setTypes(types.filter((_, j) => j !== i));
    // Sections on the removed type become Not for sale; later types shift down by one.
    setSectionType(
      Object.fromEntries(
        Object.entries(sectionType).map(([sec, v]) => {
          if (v === '') return [sec, v];
          const n = Number(v);
          return [sec, n === i ? '' : String(n > i ? n - 1 : n)];
        }),
      ),
    );
  };

  /** Spec 008 US6: ticket types, each section's type, and each type's seats. */
  const reservedSetup = (l: SeatingLayout): React.ReactElement => (
    <>
      {types.map((t, i) => (
        <div key={i} className="form__row">
          <input
            aria-label={`Ticket type ${i + 1} name`}
            placeholder="Floor"
            value={t.name}
            onChange={(e) => setType(i, { name: e.target.value })}
          />
          <input
            aria-label={`Ticket type ${i + 1} price`}
            inputMode="decimal"
            placeholder="80.00"
            value={t.price}
            onChange={(e) => setType(i, { price: e.target.value })}
          />
          {types.length > 1 && (
            <button type="button" className="btn" onClick={() => removeType(i)}>
              Remove ticket type {i + 1}
            </button>
          )}
        </div>
      ))}
      <div>
        <button
          type="button"
          className="btn"
          onClick={() => setTypes([...types, { name: '', price: '' }])}
        >
          Add ticket type
        </button>
      </div>
      {l.sections.map((sec) => (
        <div key={sec.id} className="field">
          <label htmlFor={`section-${sec.id}`}>
            {`Section ${sec.name} (${(sec.rows * sec.seatsPerRow).toLocaleString()} seats)`}
          </label>
          <select
            id={`section-${sec.id}`}
            aria-label={`Section ${sec.name} ticket type`}
            value={sectionType[sec.id] ?? ''}
            onChange={(e) => setSectionType({ ...sectionType, [sec.id]: e.target.value })}
          >
            {types.map((t, i) => (
              <option key={i} value={String(i)}>
                {t.name.trim() || `Ticket type ${i + 1}`}
              </option>
            ))}
            <option value="">Not for sale</option>
          </select>
        </div>
      ))}
      <div className="note">
        {types.map((t, i) => {
          const seats = l.sections
            .filter((sec) => sectionType[sec.id] === String(i))
            .reduce((n, sec) => n + sec.rows * sec.seatsPerRow, 0);
          return (
            <p
              key={i}
            >{`${t.name.trim() || `Ticket type ${i + 1}`}: ${seats.toLocaleString()} ${seats === 1 ? 'seat' : 'seats'}`}</p>
          );
        })}
      </div>
    </>
  );

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
      {setupRefused && (
        <div role="alert" className="banner banner--error">
          <div className="banner__body">
            <strong>Seating setup not finished</strong>
            <p>{setupRefused.error.envelope.error.message}</p>
            <p>
              The event was created; its ticket types or sections were not all set up.{' '}
              <Link to={`/events/${setupRefused.eventId}`}>Finish on the event page</Link>
            </p>
          </div>
        </div>
      )}

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

          {!isEdit && layout && (
            <fieldset className="field">
              <legend>Tickets and seating</legend>
              <label className="choice">
                <input
                  type="radio"
                  name="plan"
                  checked={plan === 'reserved'}
                  onChange={() => setPlan('reserved')}
                />
                Reserved seating
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="plan"
                  checked={plan === 'general'}
                  onChange={() => setPlan('general')}
                />
                General admission
              </label>
              {plan === 'reserved' && reservedSetup(layout)}
            </fieldset>
          )}

          <div className="field-row">
            {!isEdit && layout && plan === 'reserved' ? (
              <p className="note">
                {`Total tickets: ${layout.totalSeats.toLocaleString()}, set by the venue's seating layout.`}
              </p>
            ) : seated ? (
              <p className="note">
                {`Total tickets: ${Number(totalTicketCapacity).toLocaleString()}, set by the venue's seating layout.`}
              </p>
            ) : (
              <div className="field">
                <label htmlFor="totalTicketCapacity">Total tickets</label>
                <input
                  id="totalTicketCapacity"
                  type="number"
                  min={1}
                  value={totalTicketCapacity}
                  placeholder={selected ? String(selected.seatingCapacity) : '18000'}
                  onChange={(e) => setTotalTicketCapacity(e.target.value)}
                />
                <span className="field__hint">
                  {selected
                    ? `Up to ${selected.seatingCapacity.toLocaleString()} at ${selected.name}. `
                    : ''}
                  Leave blank to use the venue&apos;s capacity.
                </span>
              </div>
            )}
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
