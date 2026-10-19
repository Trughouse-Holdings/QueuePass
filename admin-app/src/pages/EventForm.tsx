import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type {
  ConflictingEventRef,
  EventImage,
  EventInput,
  Location,
  SeatingLayout,
} from '@queuepass/shared';
import { createEvent, getEvent, updateEvent } from '../api/events';
import { deleteEventImage, reorderEventImages, uploadEventImage } from '../api/images';
import { listLocations } from '../api/locations';
import { getLayout, getSeatMap, updateSeating } from '../api/seating';
import { createTier, deleteTier, listTiers, updateTier } from '../api/tiers';
import { ApiError } from '../api/client';
import { ErrorBanner } from '../components/ErrorBanner';
import { ImagesField, type ImageItem } from '../components/ImagesField';
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

/**
 * One ticket type on the form (spec 008 US6, US7). `id` is set for a type the event already has;
 * `quantity` is typed only for general admission (a seated type's amount follows its sections).
 */
type TicketType = { id?: string; name: string; price: string; quantity: string };

const NEW_TYPE: TicketType = { name: '', price: '', quantity: '' };

const validationError = (message: string): ApiError =>
  new ApiError(400, { error: { code: 'VALIDATION_FAILED', message } });

/** "45.5" → 4550, so prices compare as money rather than as text. */
const cents = (price: string): number => Math.round(Number(price.trim()) * 100);

/** Spec 008 R10: the event's base price is its lowest ticket type price. */
const lowestPrice = (types: TicketType[]): string =>
  types.reduce((low, t) => (cents(t.price) < cents(low.price) ? t : low)).price.trim();

/** Spec 016 research R7: the allowed range, or no upper bound while the capacity is unknown. */
const limitRefused = (most: number | null): ApiError =>
  validationError(
    most !== null
      ? `Tickets per customer must be a whole number from 1 to ${most}, or blank for no limit.`
      : 'Tickets per customer must be a whole number of at least 1, or blank for no limit.',
  );

/**
 * Spec 014 research R9: what the form hands its edit form after creating an event whose pictures
 * were not all added: the pictures not yet added, and what to tell the admin.
 */
interface PendingImagesState {
  pendingImages: File[];
  notice: string;
}

/** Spec 014: a picture step that was refused or could not be sent, and the pictures left. */
class ImageStepError extends Error {
  constructor(
    readonly file: File,
    /** The Backend's refusal, or `null` when the request could not be sent. */
    readonly refusal: ApiError | null,
    readonly remaining: File[],
  ) {
    super(refusal?.message ?? 'could not be sent');
  }

  /** "{file name}: {message}", as the form shows it (FR-017). */
  asApiError(): ApiError {
    const message = this.refusal
      ? this.refusal.envelope.error.message
      : 'It could not be sent. Check the connection and save again.';
    return new ApiError(this.refusal?.status ?? 0, {
      error: {
        ...(this.refusal?.envelope.error ?? { code: 'VALIDATION_FAILED' }),
        message: `${this.file.name}: ${message}`,
      },
    });
  }
}

const savedItem = (image: EventImage): ImageItem => ({ kind: 'saved', key: image.id, image });

/** FR-032, FR-033, FR-034, FR-035 — create/edit an event. No removal control (API-only). */
export function EventForm(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isEdit = Boolean(id);

  const [venues, setVenues] = useState<Location[]>([]);
  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [totalTicketCapacity, setTotalTicketCapacity] = useState('');
  // Spec 016 FR-008: blank is no limit.
  const [maxPerCustomer, setMaxPerCustomer] = useState('');
  // Spec 007 FR-018: a seated event's capacity is its venue's layout total.
  const [seated, setSeated] = useState(false);
  /** The event's stored base price, kept when its ticket types could not be loaded. */
  const [storedBasePrice, setStoredBasePrice] = useState('');
  // Spec 008 US6 (research R9): at a venue with a layout, set up seating while scheduling.
  const [layout, setLayout] = useState<SeatingLayout | null>(null);
  const [plan, setPlan] = useState<'reserved' | 'general'>('reserved');
  const [types, setTypes] = useState<TicketType[]>([NEW_TYPE]);
  /** Spec 008 US7: the types the event had when the form opened, to tell what changed. */
  const [loadedTypes, setLoadedTypes] = useState<TicketType[]>([]);
  const [typesLoaded, setTypesLoaded] = useState(!id);
  const [typesFailed, setTypesFailed] = useState(false);
  /** Each section's ticket type, as an index into `types`; '' is Not for sale. */
  const [sectionType, setSectionType] = useState<Record<string, string>>({});
  const [setupRefused, setSetupRefused] = useState<{ eventId: string; error: ApiError } | null>(
    null,
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // Spec 014 (research R9): the event's pictures in order; changes are made on Save.
  const [images, setImages] = useState<ImageItem[]>([]);
  const [imagesNotice, setImagesNotice] = useState<string | null>(null);
  /** Stored images the admin removed, deleted on Save. */
  const [removed, setRemoved] = useState<EventImage[]>([]);
  /** The order the Backend holds, as far as the form knows: decides whether to reorder. */
  const serverOrder = useRef<string[]>([]);
  const nextKey = useRef(0);
  const newItem = (file: File): ImageItem => ({
    kind: 'new',
    key: `new-${(nextKey.current += 1)}`,
    file,
  });

  useEffect(() => {
    listLocations()
      .then(setVenues)
      .catch(() => setVenues([]));
  }, []);

  useEffect(() => {
    if (id) return;
    setLayout(null);
    if (!locationId) return;
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
    // Spec 014 research R9: pictures not yet added when this event was created, handed over in
    // router state. Read once, then cleared from history, so going Back cannot send them again.
    const handed = location.state as PendingImagesState | null;
    const pending = (handed?.pendingImages ?? []).map(newItem);
    setImagesNotice(handed?.notice ?? null);
    if (handed?.pendingImages) navigate(location.pathname, { replace: true, state: null });
    setImages(pending);
    setRemoved([]);
    getEvent(id)
      .then((e) => {
        serverOrder.current = (e.images ?? []).map((i) => i.id);
        setImages([...(e.images ?? []).map(savedItem), ...pending]);
        setName(e.name);
        setLocationId(e.locationId);
        setStartsAt(toLocalInput(e.startsAt));
        setEndsAt(toLocalInput(e.endsAt));
        setTotalTicketCapacity(String(e.totalTicketCapacity));
        setMaxPerCustomer(e.maxTicketsPerCustomer == null ? '' : String(e.maxTicketsPerCustomer));
        setSeated(e.reservedSeating);
        setStoredBasePrice(e.basePrice);
      })
      .catch((err: ApiError) => setError(err));
    // Spec 008 US7 (R10): the event's ticket types and, at a venue with a layout, its sections.
    Promise.all([listTiers(id), getSeatMap(id).catch(() => null)])
      .then(([tiers, map]) => {
        const loaded = tiers.map((t) => ({
          id: t.id,
          name: t.name,
          price: t.price,
          quantity: String(t.quantity),
        }));
        setLoadedTypes(loaded);
        setTypes(loaded.length > 0 ? loaded : [NEW_TYPE]);
        setTypesLoaded(true);
        if (!map || map.sections.length === 0) return;
        setLayout({
          locationId: '',
          totalSeats: map.sections.reduce((n, s) => n + s.rows * s.seatsPerRow, 0),
          sections: map.sections.map((s) => ({
            id: s.sectionId,
            name: s.name,
            rows: s.rows,
            seatsPerRow: s.seatsPerRow,
          })),
        });
        setPlan(map.reservedSeating ? 'reserved' : 'general');
        setSectionType(
          Object.fromEntries(
            map.sections.map((s) => {
              if (!map.reservedSeating) return [s.sectionId, '0'];
              const i = tiers.findIndex((t) => t.id === s.tierId);
              return [s.sectionId, i < 0 ? '' : String(i)];
            }),
          ),
        );
      })
      // Without its ticket types the form saves the event's details alone.
      .catch(() => setTypesFailed(true));
  }, [id]);

  const reserved = layout !== null && plan === 'reserved';

  /** A ticket type as the Backend takes it: a quantity only for general admission. */
  const tierInput = (t: TicketType) => ({
    name: t.name.trim(),
    price: t.price.trim(),
    ...(reserved ? {} : { quantity: Number(t.quantity) }),
  });

  /** Reserved seating on, with each section mapped to its ticket type's tier. */
  const seating = (tierIds: string[]) => ({
    reservedSeating: true,
    sections: (layout?.sections ?? [])
      .filter((sec) => sectionType[sec.id] !== '' && tierIds[Number(sectionType[sec.id])])
      .map((sec) => ({ sectionId: sec.id, tierId: tierIds[Number(sectionType[sec.id])] })),
  });

  /** Spec 008 R10: create the event, then its seating and ticket types. */
  async function scheduleEvent(payload: EventInput): Promise<string | null> {
    const created = await createEvent(payload);
    try {
      if (reserved) await updateSeating(created.id, { reservedSeating: true, sections: [] });
      const tierIds: string[] = [];
      for (const t of types) tierIds.push((await createTier(created.id, tierInput(t))).id);
      if (reserved) await updateSeating(created.id, seating(tierIds));
    } catch (err) {
      setSetupRefused({ eventId: created.id, error: err as ApiError });
      return null;
    }
    return created.id;
  }

  /**
   * Spec 014 research R9: after the event's other changes, delete each removed image, upload each
   * new picture in list order, then, if the list's order differs from the Backend's, send the
   * whole order, stopping at the first refusal. Each step updates the form as it succeeds, so
   * saving again finishes what is left and never sends a picture twice (FR-015, FR-017).
   */
  async function applyImages(
    eventId: string,
    list: ImageItem[],
    toDelete: EventImage[],
  ): Promise<void> {
    for (const image of toDelete) {
      try {
        await deleteEventImage(eventId, image.id);
      } catch (err) {
        // Already gone: what this step wanted.
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }
      serverOrder.current = serverOrder.current.filter((i) => i !== image.id);
      setRemoved((now) => now.filter((r) => r.id !== image.id));
    }

    const ids: string[] = [];
    for (const [i, item] of list.entries()) {
      if (item.kind === 'saved') {
        ids.push(item.image.id);
        continue;
      }
      try {
        const image = await uploadEventImage(eventId, item.file);
        ids.push(image.id);
        serverOrder.current = [...serverOrder.current, image.id];
        setImages((now) =>
          now.map((it) => (it.key === item.key ? { kind: 'saved', key: item.key, image } : it)),
        );
      } catch (err) {
        const remaining = list.slice(i).flatMap((it) => (it.kind === 'new' ? [it.file] : []));
        throw new ImageStepError(item.file, err instanceof ApiError ? err : null, remaining);
      }
    }

    if (ids.join() === serverOrder.current.join()) return;
    const ordered = await reorderEventImages(eventId, ids);
    serverOrder.current = ordered.map((i) => i.id);
    const byId = new Map(ordered.map((i) => [i.id, i]));
    setImages((now) =>
      now.map((it) => {
        const image = it.kind === 'saved' ? byId.get(it.image.id) : undefined;
        return image ? { ...it, image } : it;
      }),
    );
  }

  /**
   * Spec 014 research R9, US3 scenario 6: the event's images changed since the form loaded them.
   * Show the event's current images, with the pictures not yet added after them, to check and
   * save again.
   */
  async function reloadImages(eventId: string): Promise<void> {
    try {
      const e = await getEvent(eventId);
      serverOrder.current = (e.images ?? []).map((i) => i.id);
      setRemoved([]);
      setImages((now) => [
        ...(e.images ?? []).map(savedItem),
        ...now.filter((it) => it.kind === 'new'),
      ]);
    } catch {
      // The refusal is shown either way; the list stays as it was.
    }
  }

  function moveImage(index: number, by: -1 | 1): void {
    setImages((now) => {
      const next = [...now];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  }

  function removeImage(index: number): void {
    const item = images[index];
    if (!item) return;
    if (item.kind === 'saved') setRemoved((now) => [...now, item.image]);
    setImages((now) => now.filter((it) => it.key !== item.key));
  }

  /**
   * Spec 008 R10: apply the edit through the existing operations, stopping at the first refusal.
   * Switching between seated and general admission happens before the ticket types change,
   * since the Backend takes a typed quantity only without reserved seating.
   */
  async function saveEvent(eventId: string, payload: EventInput): Promise<void> {
    const switching = typesLoaded && layout !== null && reserved !== seated;
    // Spec 016 research R7: turning reserved seating on raises the capacity to the layout's
    // total, which the form already checked the limit against, so the limit waits for the switch.
    const limitAfterSwitch = switching && reserved && 'maxTicketsPerCustomer' in payload;
    const { maxTicketsPerCustomer, ...details } = payload;
    await updateEvent(eventId, limitAfterSwitch ? details : payload);
    if (!typesLoaded) return;
    if (switching) await updateSeating(eventId, { reservedSeating: reserved, sections: [] });
    if (limitAfterSwitch) await updateEvent(eventId, { maxTicketsPerCustomer });
    const tierIds = types.map((t) => t.id ?? '');
    for (const [i, t] of types.entries()) {
      if (!t.id) tierIds[i] = (await createTier(eventId, tierInput(t))).id;
    }
    for (const t of types) {
      const before = loadedTypes.find((l) => l.id === t.id);
      if (!t.id || !before) continue;
      const changes = Object.fromEntries(
        Object.entries(tierInput(t)).filter(([key, value]) =>
          key === 'quantity'
            ? value !== Number(before.quantity)
            : value !== before[key as 'name' | 'price'],
        ),
      );
      if (Object.keys(changes).length > 0) await updateTier(eventId, t.id, changes);
    }
    if (reserved) await updateSeating(eventId, seating(tierIds));
    for (const l of loadedTypes) {
      if (l.id && !types.some((t) => t.id === l.id)) await deleteTier(eventId, l.id);
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSetupRefused(null);
    setSaved(false);
    setImagesNotice(null);

    // Spec 016 research R7: a preview of the Backend's range check; the Backend decides.
    const limit = maxPerCustomer.trim();
    const most = capacityPreview();
    if (
      limit !== '' &&
      (!Number.isInteger(Number(limit)) ||
        Number(limit) < 1 ||
        (most !== null && Number(limit) > most))
    ) {
      setError(limitRefused(most));
      return;
    }

    if (typesLoaded) {
      const blank = (t: TicketType) =>
        !t.name.trim() || !t.price.trim() || (!reserved && !t.quantity.trim());
      if (types.some(blank)) {
        setError(
          validationError(
            reserved
              ? 'Give every ticket type a name and a price.'
              : 'Give every ticket type a name, a price, and a quantity.',
          ),
        );
        return;
      }
    }
    setBusy(true);

    const payload: EventInput = {
      name,
      locationId,
      startsAt: toIso(startsAt),
      endsAt: toIso(endsAt),
      // FR-019: blank means the venue's capacity; seated events never send one (FR-018).
      ...(!seated && !reserved && totalTicketCapacity.trim() !== ''
        ? { totalTicketCapacity: Number(totalTicketCapacity) }
        : {}),
      // Spec 016 research R7: an edit always sends it, so clearing it sends null.
      ...(limit !== ''
        ? { maxTicketsPerCustomer: Number(limit) }
        : isEdit
          ? { maxTicketsPerCustomer: null }
          : {}),
      // Spec 008 FR-019: no base price field; the event is priced from its ticket types.
      basePrice: typesLoaded ? lowestPrice(types) : storedBasePrice,
    };

    const list = images;
    const toDelete = removed;
    let eventId = id;
    try {
      if (isEdit && id) await saveEvent(id, payload);
      else eventId = (await scheduleEvent(payload)) ?? undefined;
      if (!eventId) return;
      try {
        await applyImages(eventId, list, toDelete);
      } catch (err) {
        if (!(err instanceof ImageStepError) || isEdit) throw err;
        // Spec 014 FR-018: the event, its seating, and its ticket types are saved; the form
        // becomes that event's edit form with the pictures not yet added, so saving again
        // changes only this event.
        const [first, ...rest] = err.remaining;
        const why = err.refusal ? err.refusal.envelope.error.message : 'could not be sent';
        const names = [`${first!.name} (${why})`, ...rest.map((f) => f.name)].join(', ');
        const handed: PendingImagesState = {
          pendingImages: err.remaining,
          notice: `Event created. These pictures were not added: ${names}. Save again to add them.`,
        };
        navigate(`/events/${eventId}/edit`, { replace: true, state: handed });
        return;
      }
      setSaved(true);
      setTimeout(() => navigate(`/events/${eventId}`), 700);
    } catch (err) {
      // FR-035: state is deliberately untouched here — re-entering a whole form to fix
      // one time is exactly the friction this requirement exists to prevent.
      setError(err instanceof ImageStepError ? err.asApiError() : (err as ApiError));
      if (err instanceof ApiError && err.code === 'IMAGES_CHANGED' && eventId) {
        await reloadImages(eventId);
      }
    } finally {
      setBusy(false);
    }
  }

  const conflict =
    error?.code === 'SCHEDULING_CONFLICT'
      ? ((error.details?.conflictingEvent ?? null) as ConflictingEventRef | null)
      : null;

  const selected = venues.find((v) => v.id === locationId);

  /**
   * Spec 016 research R7: the capacity the event will have, as the Total tickets row shows it:
   * the layout total when seated, else the typed total, else the venue's; `null` while unknown.
   */
  function capacityPreview(): number | null {
    if (reserved && layout) return layout.totalSeats;
    if (seated || totalTicketCapacity.trim() !== '') return Number(totalTicketCapacity);
    return selected ? selected.seatingCapacity : null;
  }

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

  /** Spec 008 US6, US7: the ticket types, with a quantity for general admission. */
  const typeLines = (
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
          {!reserved && (
            <input
              aria-label={`Ticket type ${i + 1} quantity`}
              type="number"
              min={1}
              placeholder="100"
              value={t.quantity}
              onChange={(e) => setType(i, { quantity: e.target.value })}
            />
          )}
          {types.length > 1 && (
            <button type="button" className="btn" onClick={() => removeType(i)}>
              Remove ticket type {i + 1}
            </button>
          )}
        </div>
      ))}
      <div>
        <button type="button" className="btn" onClick={() => setTypes([...types, NEW_TYPE])}>
          Add ticket type
        </button>
      </div>
    </>
  );

  /** Spec 008 US6: each section's ticket type, and each type's seats. */
  const sectionSetup = (l: SeatingLayout): React.ReactElement => (
    <>
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
      {imagesNotice && (
        <div role="status" className="banner">
          <div className="banner__body">
            <p>{imagesNotice}</p>
          </div>
        </div>
      )}
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

          {typesLoaded && layout && (
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
              {typeLines}
              {reserved && sectionSetup(layout)}
            </fieldset>
          )}
          {typesLoaded && !layout && (
            <fieldset className="field">
              <legend>Ticket types</legend>
              {typeLines}
            </fieldset>
          )}
          {typesFailed && (
            <p className="note">
              This event&apos;s ticket types could not be loaded, so saving changes only the details
              above.
            </p>
          )}

          <div className="field-row">
            {reserved && layout ? (
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
          </div>

          <div className="field">
            <label htmlFor="maxTicketsPerCustomer">Tickets per customer</label>
            <input
              id="maxTicketsPerCustomer"
              type="number"
              min={1}
              step={1}
              value={maxPerCustomer}
              onChange={(e) => setMaxPerCustomer(e.target.value)}
              // The browser blocks 0 or a fraction itself; say the range instead of its bubble.
              onInvalid={(e) => {
                e.preventDefault();
                setError(limitRefused(capacityPreview()));
              }}
            />
            <span className="field__hint">Leave blank for no limit.</span>
          </div>

          <ImagesField
            eventId={id}
            items={images}
            onAdd={(files) => setImages((now) => [...now, ...files.map(newItem)])}
            onMove={moveImage}
            onRemove={removeImage}
          />

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
