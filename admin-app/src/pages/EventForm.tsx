import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type {
  ConflictingEventRef,
  EventImage,
  EventInput,
  Location,
  SeatingLayout,
} from '@queuepass/shared';
import {
  DEFAULT_TIME_ZONE,
  EVENT_IMAGE_LIMITS,
  abbreviationAt,
  doorsOpenProblem,
  doorsOpenRangeMessage,
  formatLocalTime,
  skippedTimeMessage,
  toLocalDateTime,
  toOffsetDateTime,
  zoneName,
  type ResolvedLocal,
  type UsTimeZone,
} from '@queuepass/shared';
import { until, when } from '../format';
import { createEvent, getEvent, updateEvent } from '../api/events';
import { deleteEventImage, reorderEventImages, uploadEventImage } from '../api/images';
import { listLocations } from '../api/locations';
import { getAvailability, getLayout, getSeatMap } from '../api/seating';
import { listTiers } from '../api/tiers';
import { ApiError } from '../api/client';
import {
  fieldErrors,
  firstErrorKey,
  firstPlacedKey,
  focusIdFor,
  lockReason,
  momentOf,
  previewErrors,
  resolveField,
  seatTotals,
  visibleErrors,
  type Occurrence,
  type SoldCounts,
  type TimeField,
  type TypeFieldError,
  TYPE_FIELDS,
} from './event-form-checks';
import { DateTimeFields } from './DateTimeFields';
import {
  DEFAULT_DOORS_OFFSET_MINUTES,
  doorsInstantBeforeStart,
  doorsModeForStoredGapMs,
  doorsOffsetOptions,
  doorsOpenAtPreview,
  isExactDoorsOffsetMinutes,
  type DoorsMode,
} from './event-form-times';
import { ErrorBanner } from '../components/ErrorBanner';
import { ImagesField, type ImageItem } from '../components/ImagesField';
import { SuccessState } from '../components/SuccessState';

/**
 * Spec 036 FR-010: a time field's error focuses its date control, or its time control when only
 * the time is missing; in "Before the start" mode a doors error focuses the length select.
 */
function timeAwareFocusId(key: string): string {
  if (key === 'doorsOpenAt' && document.getElementById('doorsOpenOffset')) return 'doorsOpenOffset';
  if (key === 'startsAt' || key === 'endsAt' || key === 'doorsOpenAt') {
    const date = document.getElementById(`${key}-date`) as HTMLInputElement | null;
    const time = document.getElementById(`${key}-time`) as HTMLInputElement | null;
    return date?.value && time && !time.value ? `${key}-time` : `${key}-date`;
  }
  return focusIdFor(key);
}

/**
 * One ticket type on the form (spec 008 US6, US7). `id` is set for a type the event already has;
 * `quantity` is typed only for general admission (a seated type's amount follows its sections).
 */
type TicketType = { id?: string; name: string; price: string; quantity: string };

const NEW_TYPE: TicketType = { name: '', price: '', quantity: '' };

/** "45.5" → 4550, so prices compare as money rather than as text. */
const cents = (price: string): number => Math.round(Number(price.trim()) * 100);

/** Spec 008 R10: the event's base price is its lowest ticket type price. */
const lowestPrice = (types: TicketType[]): string =>
  types.reduce((low, t) => (cents(t.price) < cents(low.price) ? t : low)).price.trim();

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

const savedItem = (image: EventImage, file?: File): ImageItem => ({
  kind: 'saved',
  key: image.id,
  image,
  ...(file ? { file } : {}),
});

/** Spec 031 FR-011: a schedule that got no answer may or may not have been saved. */
const noAnswerFrom = (err: unknown): boolean =>
  !(err instanceof ApiError) || (err.status >= 500 && !err.enveloped);

/** FR-032, FR-033, FR-034, FR-035 — create/edit an event. No removal control (API-only). */
export function EventForm(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isEdit = Boolean(id);

  const [venues, setVenues] = useState<Location[]>([]);
  /** Spec 020 (review round 1, S1): the edited event's own venue, as the event carries it. */
  const [eventVenue, setEventVenue] = useState<Location | null>(null);
  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState('');
  // Spec 020 research R13: plain local strings, read in the chosen venue's zone.
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  // Spec 025 research R4: Doors open, a local string like the start, following the start (same
  // gap) until the admin changes it themselves.
  const [doorsOpenAt, setDoorsOpenAt] = useState('');
  // Spec 036: two ways to set doors open; a new event starts in "Before the start", 1 hour.
  const [doorsMode, setDoorsMode] = useState<DoorsMode>('before');
  const [doorsOffsetMinutes, setDoorsOffsetMinutes] = useState<number | null>(
    DEFAULT_DOORS_OFFSET_MINUTES,
  );
  /** Once a save was tried, the range message under Doors open is announced (role="alert"). */
  const [doorsChecked, setDoorsChecked] = useState(false);
  const [occurrence, setOccurrence] = useState<Record<TimeField, Occurrence>>({
    startsAt: '',
    endsAt: '',
    doorsOpenAt: '',
  });
  const [totalTicketCapacity, setTotalTicketCapacity] = useState('');
  // Spec 016 FR-008: blank is no limit.
  const [maxPerCustomer, setMaxPerCustomer] = useState('');
  // Spec 007 FR-018: a seated event's capacity is its venue's layout total.
  const [seated, setSeated] = useState(false);
  /** The event's stored base price, kept when its ticket types could not be loaded. */
  const [storedBasePrice, setStoredBasePrice] = useState('');
  // Spec 008 US6 (research R9): at a venue with a layout, set up seating while scheduling.
  const [layout, setLayout] = useState<SeatingLayout | null>(null);
  const [layoutReady, setLayoutReady] = useState(false);
  const [plan, setPlan] = useState<'reserved' | 'general'>('reserved');
  const [types, setTypes] = useState<TicketType[]>([NEW_TYPE]);
  const [typesLoaded, setTypesLoaded] = useState(!id);
  const [typesFailed, setTypesFailed] = useState(false);
  // Spec 035 (research R5): a field shows its preview error after it is left, then as the admin types.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [live, setLive] = useState('');
  const announced = useRef<Set<string>>(new Set());
  const EMPTY_SOLD: SoldCounts = {
    eventSold: 0,
    soldByTier: new Map(),
    soldBySection: new Map(),
  };
  const [sold, setSold] = useState<SoldCounts>(EMPTY_SOLD);
  /** Each section's ticket type, as an index into `types`; '' is Not for sale. */
  const [sectionType, setSectionType] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  /** Spec 031 FR-011: the schedule request got no answer; the event may or may not exist. */
  const [noAnswer, setNoAnswer] = useState(false);
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
    setLayoutReady(false);
    if (!locationId) return;
    let cancelled = false;
    getLayout(locationId)
      .then((l) => {
        if (cancelled) return;
        setLayout(l.sections.length > 0 ? l : null);
        // Every section sells the first ticket type until the admin says otherwise.
        setSectionType(Object.fromEntries(l.sections.map((s) => [s.id, '0'])));
        setLayoutReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setLayout(null);
          setLayoutReady(true);
        }
      });
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
        setImages([...(e.images ?? []).map((image) => savedItem(image)), ...pending]);
        setName(e.name);
        setLocationId(e.locationId);
        setEventVenue(e.location ?? null);
        // Spec 020 FR-017 (research R13): the venue's local times, and for a repeated local time
        // the occurrence the stored instant is.
        const zone = e.location?.timeZone ?? DEFAULT_TIME_ZONE;
        const local = (iso: string): [string, Occurrence] => {
          const value = toLocalDateTime(iso, zone);
          const r = resolveField(value, zone);
          if (r?.kind !== 'repeated') return [value, ''];
          // Review round 2, m1: the stored instant's own offset names its occurrence, so seconds
          // (which the minute-precise input drops) cannot turn the first time into the second.
          return [
            value,
            toOffsetDateTime(iso, zone).slice(-6) === r.first.offset ? 'first' : 'second',
          ];
        };
        const [start, startOcc] = local(e.startsAt);
        const [end, endOcc] = local(e.endsAt);
        // Spec 025 FR-002 (research R4): the stored doors, and their gap to the stored start.
        const [doors, doorsOcc]: [string, Occurrence] = e.doorsOpenAt
          ? local(e.doorsOpenAt)
          : ['', ''];
        setStartsAt(start);
        setEndsAt(end);
        let doorsLocal = doors;
        let doorsOccFinal = doorsOcc;
        let mode: DoorsMode = 'before';
        let offset: number | null = DEFAULT_DOORS_OFFSET_MINUTES;
        if (e.doorsOpenAt) {
          const gapMs = Date.parse(e.startsAt) - Date.parse(e.doorsOpenAt);
          mode = doorsModeForStoredGapMs(gapMs);
          const gapMinutes = gapMs / 60_000;
          offset =
            mode === 'before'
              ? gapMinutes
              : isExactDoorsOffsetMinutes(gapMinutes)
                ? gapMinutes
                : null;
        } else if (Number.isFinite(Date.parse(e.startsAt))) {
          // No stored doors (a Backend before 025): 1 hour before the stored start, so the
          // preview and what would be sent agree (036 FR-004, FR-005).
          const instant = doorsInstantBeforeStart(
            new Date(e.startsAt),
            DEFAULT_DOORS_OFFSET_MINUTES,
          );
          doorsLocal = toLocalDateTime(instant, zone);
          const r = resolveField(doorsLocal, zone);
          doorsOccFinal =
            r?.kind !== 'repeated'
              ? ''
              : toOffsetDateTime(instant, zone).slice(-6) === r.first.offset
                ? 'first'
                : 'second';
        }
        setDoorsOpenAt(doorsLocal);
        setDoorsMode(mode);
        setDoorsOffsetMinutes(offset);
        setOccurrence({ startsAt: startOcc, endsAt: endOcc, doorsOpenAt: doorsOccFinal });
        setTotalTicketCapacity(String(e.totalTicketCapacity));
        setMaxPerCustomer(e.maxTicketsPerCustomer == null ? '' : String(e.maxTicketsPerCustomer));
        setSeated(e.reservedSeating);
        setStoredBasePrice(e.basePrice);
      })
      .catch((err: ApiError) => setError(err));
    // Spec 008 US7 (R10): the event's ticket types and, at a venue with a layout, its sections.
    Promise.all([
      listTiers(id),
      getSeatMap(id).catch(() => null),
      getAvailability(id).catch(() => null),
    ])
      .then(([tiers, map, availability]) => {
        const loaded = tiers.map((t) => ({
          id: t.id,
          name: t.name,
          price: t.price,
          quantity: String(t.quantity),
        }));
        setTypes(loaded.length > 0 ? loaded : [NEW_TYPE]);
        setTypesLoaded(true);
        setLayoutReady(true);
        const soldByTier = new Map<string, number>();
        if (availability) {
          const leftByTier = new Map(
            availability.tiers.map((row) => [row.tierId, row.ticketsLeft]),
          );
          let eventSold = 0;
          for (const t of tiers) {
            const left = leftByTier.get(t.id);
            const soldCount = left == null ? 0 : Math.max(0, t.quantity - left);
            soldByTier.set(t.id, soldCount);
            eventSold += soldCount;
          }
          setSold((now) => ({
            ...now,
            eventSold: Math.max(eventSold, now.eventSold),
            soldByTier,
          }));
        }
        if (map) {
          setSold((now) => ({
            ...now,
            eventSold: Math.max(
              now.eventSold,
              map.sections.reduce((n, s) => n + s.sold, 0),
            ),
            soldBySection: new Map(map.sections.map((s) => [s.sectionId, s.sold])),
            soldByTier: now.soldByTier.size > 0 ? now.soldByTier : soldByTier,
          }));
        }
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
      .catch(() => {
        setTypesFailed(true);
        setLayoutReady(true);
      });
  }, [id]);

  const reserved = layout !== null && plan === 'reserved';

  /** A ticket type as the Backend takes it: a quantity only for general admission. */
  const tierInput = (t: TicketType) => ({
    name: t.name.trim(),
    price: t.price.trim(),
    ...(reserved ? {} : { quantity: Number(t.quantity) }),
  });

  /**
   * Spec 031 (research R4, R5): the event, its ticket types, and its seating in one request, which
   * the Backend saves all or nothing. With reserved seating, each type lists the sections whose
   * select names it; a section set to Not for sale is in none.
   */
  async function scheduleEvent(payload: EventInput): Promise<string> {
    const created = await createEvent({
      ...payload,
      ...(reserved ? { reservedSeating: true } : {}),
      tiers: types.map((t, i) => ({
        ...tierInput(t),
        ...(reserved
          ? {
              sectionIds: (layout?.sections ?? [])
                .filter((sec) => sectionType[sec.id] === String(i))
                .map((sec) => sec.id),
            }
          : {}),
      })),
    });
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
          now.map((it) =>
            // The file stays with it: its preview is not read back (review of PR #63).
            it.key === item.key ? { kind: 'saved', key: item.key, image, file: item.file } : it,
          ),
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
      setImages((now) => {
        // Pictures sent from this form keep showing from their files.
        const files = new Map(
          now.flatMap((it) => (it.kind === 'saved' && it.file ? [[it.image.id, it.file]] : [])),
        );
        return [
          ...(e.images ?? []).map((image) => savedItem(image, files.get(image.id))),
          ...now.filter((it) => it.kind === 'new'),
        ];
      });
    } catch {
      // The refusal is shown either way; the list stays as it was.
    }
  }

  /**
   * FR-014: at most 5, checked against the latest list (ImagesField has already refused, with a
   * note, whatever it saw would not fit; this only guards the list itself).
   */
  function addImages(files: File[]): void {
    const added = files.map(newItem);
    setImages((now) => [...now, ...added].slice(0, EVENT_IMAGE_LIMITS.maxCount));
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
   * Spec 035 FR-016 to FR-019 (research R8): one update request carries the event, its ticket
   * types, and its reserved seating, saved all or nothing. If the types could not be loaded, only
   * the details are sent, as before.
   */
  async function saveEvent(eventId: string, payload: EventInput): Promise<void> {
    if (!typesLoaded) {
      await updateEvent(eventId, payload);
      return;
    }
    await updateEvent(eventId, {
      ...payload,
      reservedSeating: reserved,
      tiers: types.map((t, i) => ({
        ...(t.id ? { id: t.id } : {}),
        ...tierInput(t),
        ...(reserved
          ? {
              sectionIds: (layout?.sections ?? [])
                .filter((sec) => sectionType[sec.id] === String(i))
                .map((sec) => sec.id),
            }
          : {}),
      })),
    });
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setNoAnswer(false);
    setSaved(false);
    setImagesNotice(null);

    // Spec 035 FR-003 to FR-007 (research R3, R5): never send a known problem; show every
    // current preview error and focus the first field at fault.
    setSubmitted(true);
    setDoorsChecked(true);
    const all = previewErrors({
      name,
      locationId,
      startsAt,
      endsAt,
      doorsOpenAt,
      venueZone,
      hasVenue: Boolean(selected),
      occurrence,
      typesLoaded,
      types,
      reserved,
      totalTicketCapacity,
      venueCapacity: selected ? selected.seatingCapacity : null,
      layoutSeats: layout?.totalSeats ?? null,
      maxPerCustomer,
      sectionType,
      sections: layout?.sections,
      doorsFromStart: doorsMode === 'before' && doorsOffsetMinutes != null,
    });
    if (all.size > 0) {
      const first = firstErrorKey(all, types.length);
      if (first) {
        requestAnimationFrame(() => document.getElementById(timeAwareFocusId(first))?.focus());
      }
      return;
    }

    const limit = maxPerCustomer.trim();
    const sent: Record<TimeField, string> = { startsAt, endsAt, doorsOpenAt };
    const instants: Partial<Record<TimeField, Date>> = {};
    for (const field of ['startsAt', 'endsAt', 'doorsOpenAt'] as const) {
      const r = resolveField(sent[field], venueZone);
      const m = r ? momentOf(r, occurrence[field]) : null;
      if (!m) return;
      sent[field] = toOffsetDateTime(m.instant, venueZone);
      instants[field] = m.instant;
    }

    setBusy(true);

    const payload: EventInput = {
      name,
      locationId,
      startsAt: sent.startsAt,
      endsAt: sent.endsAt,
      // Spec 025 FR-007 (research R4): always sent, like the start and end.
      doorsOpenAt: sent.doorsOpenAt,
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
      else {
        try {
          eventId = await scheduleEvent(payload);
        } catch (err) {
          // FR-011 (research R6): no answer, or a gateway's answer, is not a refusal. Every
          // value stays; the admin checks the Events list before scheduling again.
          if (!noAnswerFrom(err)) throw err;
          setNoAnswer(true);
          return;
        }
      }
      if (!eventId) return;
      try {
        await applyImages(eventId, list, toDelete);
      } catch (err) {
        if (!(err instanceof ImageStepError) || isEdit) throw err;
        // Spec 014 FR-018: the event, its seating, and its ticket types are saved (031: in one
        // request, so always together); the form becomes that event's edit form with the
        // pictures not yet added, so saving again changes only this event.
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

  // Spec 035 FR-010, FR-019: a refusal that names a field is placed on create and on edit.
  const placed = fieldErrors(error);
  useEffect(() => {
    if (!error) return;
    const first = firstPlacedKey(fieldErrors(error), types.length);
    if (!first) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(timeAwareFocusId(first))?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [error, types.length]);
  const typeErrors = (i: number, section: boolean): TypeFieldError[] =>
    (placed.types.get(i) ?? []).filter((e) => (e.field === 'sectionIds' && reserved) === section);
  /** The type's input for `field` is invalid when a message names it, or names no known field. */
  const invalid = (i: number, field: string): boolean =>
    typeErrors(i, false).some((e) => e.field === field || !TYPE_FIELDS.includes(e.field));
  /** The seating hint, described by the seating choice (FR-010). */
  const seatingProps = placed.seating.length > 0 ? { 'aria-describedby': 'seating-error' } : {};
  /** A section select is tied to the hint of the ticket type it sells. */
  const sectionProps = (sectionId: string) => {
    const chosen = sectionType[sectionId] ?? '';
    return chosen !== '' && typeErrors(Number(chosen), true).length > 0
      ? { 'aria-invalid': true as const, 'aria-describedby': `seats-${Number(chosen) + 1}-error` }
      : {};
  };
  const hint = (id: string, messages: string[]): React.ReactElement | null =>
    messages.length > 0 ? (
      <span className="field__hint" role="alert" id={id} data-testid={id}>
        {messages.join(' ')}
      </span>
    ) : null;

  const conflict =
    error?.code === 'SCHEDULING_CONFLICT'
      ? ((error.details?.conflictingEvent ?? null) as ConflictingEventRef | null)
      : null;
  // Spec 032: times are locked once check-in details are removed. Shown with the times, like a
  // scheduling conflict, not next to submit.
  const timesRefusal =
    error?.code === 'SCHEDULING_CONFLICT' || error?.code === 'CHECK_IN_DETAILS_REMOVED';

  // Spec 020 (review round 1, S1): while the venue list has failed or not arrived, the edited
  // event's own venue stands in, so its zone is never replaced by Eastern by accident.
  const selected =
    venues.find((v) => v.id === locationId) ??
    (eventVenue && eventVenue.id === locationId ? eventVenue : undefined);
  /** Spec 020 FR-014: the chosen venue's zone; Eastern until a venue is chosen. */
  const venueZone: UsTimeZone = selected?.timeZone ?? DEFAULT_TIME_ZONE;
  const resolved: Record<TimeField, ResolvedLocal | null> = {
    startsAt: resolveField(startsAt, venueZone),
    endsAt: resolveField(endsAt, venueZone),
    doorsOpenAt: resolveField(doorsOpenAt, venueZone),
  };
  const typed: Record<TimeField, string> = { startsAt, endsAt, doorsOpenAt };

  /**
   * Spec 036 FR-006: in "Before the start" mode, a start that names one moment sets doors to that
   * instant minus the chosen length (elapsed). In "At a set time" mode doors stay put (FR-007).
   * The occurrence of a repeated doors time is the one the instant is.
   */
  function applyDoorsOffset(
    local: string,
    chosen: Occurrence,
    zone: UsTimeZone = venueZone,
    minutes: number | null = doorsOffsetMinutes,
  ): void {
    if (doorsMode !== 'before' || minutes == null) return;
    setDoorsFromStart(local, chosen, zone, minutes);
  }

  /** Doors at the start minus `minutes` (elapsed), once the start names one moment. */
  function setDoorsFromStart(
    local: string,
    chosen: Occurrence,
    zone: UsTimeZone,
    minutes: number,
  ): void {
    const r = resolveField(local, zone);
    const m = r ? momentOf(r, chosen) : null;
    if (!m) return;
    const instant = doorsInstantBeforeStart(m.instant, minutes);
    const value = toLocalDateTime(instant, zone);
    const doors = resolveField(value, zone);
    const occ: Occurrence =
      doors?.kind !== 'repeated'
        ? ''
        : toOffsetDateTime(instant, zone).slice(-6) === doors.first.offset
          ? 'first'
          : 'second';
    setDoorsOpenAt(value);
    setOccurrence((o) => ({ ...o, doorsOpenAt: occ }));
  }

  function switchDoorsMode(next: DoorsMode): void {
    if (next === 'at-time') {
      setDoorsMode('at-time');
      return;
    }
    const start = resolved.startsAt ? momentOf(resolved.startsAt, occurrence.startsAt) : null;
    const doors = resolved.doorsOpenAt
      ? momentOf(resolved.doorsOpenAt, occurrence.doorsOpenAt)
      : null;
    if (start && doors) {
      // FR-002, FR-014: the same instant; an off-step gap shows no length and is not rounded.
      const minutes = (start.instant.getTime() - doors.instant.getTime()) / 60_000;
      setDoorsOffsetMinutes(isExactDoorsOffsetMinutes(minutes) ? minutes : null);
    } else {
      // FR-015: doors that name no moment are derived from the start (kept length, else 1 hour).
      const minutes = doorsOffsetMinutes ?? DEFAULT_DOORS_OFFSET_MINUTES;
      setDoorsOffsetMinutes(minutes);
      if (start) setDoorsFromStart(startsAt, occurrence.startsAt, venueZone, minutes);
    }
    setDoorsMode('before');
  }

  /**
   * Spec 036 FR-004, FR-014: the resulting time next to the length, once the start names one
   * moment; with no length chosen (an off-step gap), the kept doors time.
   */
  function doorsPreview(): string | null {
    if (doorsMode !== 'before' || !selected) return null;
    const start = resolved.startsAt ? momentOf(resolved.startsAt, occurrence.startsAt) : null;
    if (!start) return null;
    let instant: Date;
    if (doorsOffsetMinutes == null) {
      const doors = resolved.doorsOpenAt
        ? momentOf(resolved.doorsOpenAt, occurrence.doorsOpenAt)
        : null;
      if (!doors) return null;
      instant = doors.instant;
    } else {
      instant = doorsInstantBeforeStart(start.instant, doorsOffsetMinutes);
    }
    return doorsOpenAtPreview(instant, venueZone, start.instant);
  }
  const doorsLine = doorsPreview();

  /** Spec 025 FR-005: the range message under Doors open once both times name one moment. */
  function doorsRangeNote(): React.ReactElement | null {
    const start = resolved.startsAt ? momentOf(resolved.startsAt, occurrence.startsAt) : null;
    const doors = resolved.doorsOpenAt
      ? momentOf(resolved.doorsOpenAt, occurrence.doorsOpenAt)
      : null;
    if (!selected || !start || !doors || !doorsOpenProblem(start.instant, doors.instant)) {
      return null;
    }
    return (
      <span
        className="field__hint"
        data-testid="doorsOpenAt-range"
        role={doorsChecked ? 'alert' : undefined}
      >
        {doorsOpenRangeMessage(start.instant, venueZone)}
      </span>
    );
  }

  /** "Times are in the venue's time zone: Eastern Time (EDT)." with the typed start's abbreviation. */
  function zoneLine(): string {
    if (!selected) return "Choose a venue first: times are in the venue's local time.";
    const start = resolved.startsAt;
    const m =
      start?.kind === 'ok'
        ? start.moment
        : start?.kind === 'repeated'
          ? (momentOf(start, occurrence.startsAt) ?? start.first)
          : null;
    const abbreviation = m ? m.abbreviation : abbreviationAt(new Date(), venueZone);
    return `Times are in the venue's time zone: ${zoneName(venueZone)} (${abbreviation}).`;
  }

  /** Under a time field: a skipped time's message, or the question for a repeated one. */
  function timeNote(field: TimeField): React.ReactElement | null {
    const r = selected ? resolved[field] : null;
    const local = typed[field];
    if (!r) return null;
    if (r.kind === 'skipped') {
      return (
        <span className="field__hint" data-testid={`${field}-skipped`}>
          {skippedTimeMessage(local, venueZone, r.skippedFrom, r.skippedTo)}
        </span>
      );
    }
    if (r.kind !== 'repeated') return null;
    const time = formatLocalTime(local);
    const choose = (value: Occurrence) => {
      setOccurrence((o) => ({ ...o, [field]: value }));
      if (field === 'startsAt') applyDoorsOffset(startsAt, value);
    };
    return (
      <fieldset className="field" data-testid={`${field}-occurrence`}>
        <legend>{`Which ${time}?`}</legend>
        <label className="choice">
          <input
            type="radio"
            name={`${field}-occurrence`}
            checked={occurrence[field] === 'first'}
            onChange={() => choose('first')}
          />
          {`${time} ${r.first.abbreviation} (the first time)`}
        </label>
        <label className="choice">
          <input
            type="radio"
            name={`${field}-occurrence`}
            checked={occurrence[field] === 'second'}
            onChange={() => choose('second')}
          />
          {`${time} ${r.second.abbreviation} (the second time)`}
        </label>
      </fieldset>
    );
  }

  const previewAll = previewErrors({
    name,
    locationId,
    startsAt,
    endsAt,
    doorsOpenAt,
    venueZone,
    hasVenue: Boolean(selected),
    occurrence,
    typesLoaded,
    types,
    reserved,
    totalTicketCapacity,
    venueCapacity: selected ? selected.seatingCapacity : null,
    layoutSeats: layout?.totalSeats ?? null,
    maxPerCustomer,
    sectionType,
    sections: layout?.sections,
    doorsFromStart: doorsMode === 'before' && doorsOffsetMinutes != null,
  });
  const preview = visibleErrors(previewAll, touched, submitted);
  const totals = seatTotals({
    reserved,
    types,
    sections: layout?.sections,
    sectionType,
    totalTicketCapacity,
    venueCapacity: selected ? selected.seatingCapacity : null,
    layoutSeats: layout?.totalSeats ?? null,
  });
  const mark = (key: string) => setTouched((now) => new Set(now).add(key));
  const clearServer = () => {
    if (error) setError(null);
  };
  const fieldHint = (key: string): string[] =>
    placed.fields.get(key) ?? (preview.get(key) ? [preview.get(key)!] : []);
  const fieldProps = (key: string, testId = `${key}-error`) =>
    fieldHint(key).length > 0 ? { 'aria-invalid': true as const, 'aria-describedby': testId } : {};

  const timeChromeMessages = (): Set<string> => {
    const msgs = new Set<string>();
    const start = resolved.startsAt ? momentOf(resolved.startsAt, occurrence.startsAt) : null;
    const doors = resolved.doorsOpenAt
      ? momentOf(resolved.doorsOpenAt, occurrence.doorsOpenAt)
      : null;
    if (selected && start && doors && doorsOpenProblem(start.instant, doors.instant)) {
      msgs.add(doorsOpenRangeMessage(start.instant, venueZone));
    }
    for (const field of ['startsAt', 'endsAt', 'doorsOpenAt'] as const) {
      const r = selected ? resolved[field] : null;
      const local = typed[field];
      if (!r) continue;
      if (r.kind === 'skipped') {
        msgs.add(skippedTimeMessage(local, venueZone, r.skippedFrom, r.skippedTo));
      }
    }
    return msgs;
  };

  const previewKeys = [...preview.keys()].sort().join('|');
  useEffect(() => {
    for (const key of [...announced.current]) {
      if (!preview.has(key)) announced.current.delete(key);
    }
    const next = [...preview.keys()].filter((key) => !announced.current.has(key));
    if (next.length > 0) {
      setLive(next.map((key) => preview.get(key)!).join(' '));
      for (const key of next) announced.current.add(key);
    } else if (preview.size === 0) {
      setLive('');
    }
  }, [previewKeys]);

  const typeInvalid = (i: number, field: string): boolean =>
    invalid(i, field) || preview.has(`tiers.${i}.${field}`);
  const typeHint = (i: number, section: boolean): string[] => {
    const server = typeErrors(i, section).map((e) => e.message);
    if (server.length > 0) return server;
    if (section)
      return preview.get(`tiers.${i}.sectionIds`) ? [preview.get(`tiers.${i}.sectionIds`)!] : [];
    const keys = ['name', 'price', 'quantity'] as const;
    return keys.flatMap((field) =>
      preview.get(`tiers.${i}.${field}`) ? [preview.get(`tiers.${i}.${field}`)!] : [],
    );
  };

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
  const typeControl = (i: number, field: 'name' | 'price' | 'quantity') => ({
    id: `type-${i + 1}-${field}`,
    ...(typeInvalid(i, field)
      ? { 'aria-invalid': true as const, 'aria-describedby': `type-${i + 1}-error` }
      : {}),
    onBlur: () => mark(`tiers.${i}.${field}`),
  });
  const soldFor = (t: TicketType): number => (t.id ? (sold.soldByTier.get(t.id) ?? 0) : 0);
  const typeLines = (
    <>
      {types.map((t, i) => (
        <Fragment key={i}>
          <div className="form__row">
            <input
              aria-label={`Ticket type ${i + 1} name`}
              placeholder="Floor"
              value={t.name}
              onChange={(e) => {
                clearServer();
                setType(i, { name: e.target.value });
              }}
              {...typeControl(i, 'name')}
            />
            <input
              aria-label={`Ticket type ${i + 1} price`}
              inputMode="decimal"
              placeholder="80.00"
              value={t.price}
              onChange={(e) => {
                clearServer();
                setType(i, { price: e.target.value });
              }}
              {...typeControl(i, 'price')}
            />
            {!reserved && (
              <input
                aria-label={`Ticket type ${i + 1} quantity`}
                type="number"
                min={1}
                placeholder="100"
                value={t.quantity}
                onChange={(e) => {
                  clearServer();
                  setType(i, { quantity: e.target.value });
                }}
                {...typeControl(i, 'quantity')}
              />
            )}
            {types.length > 1 && (
              <button
                type="button"
                className="btn"
                onClick={() => removeType(i)}
                disabled={soldFor(t) > 0}
                title={soldFor(t) > 0 ? lockReason.type : undefined}
              >
                Remove ticket type {i + 1}
              </button>
            )}
          </div>
          {soldFor(t) > 0 && <span className="field__hint">{lockReason.quantity(soldFor(t))}</span>}
          {hint(`type-${i + 1}-error`, typeHint(i, false))}
        </Fragment>
      ))}
      <div>
        <button type="button" className="btn" onClick={() => setTypes([...types, NEW_TYPE])}>
          Add ticket type
        </button>
      </div>
      {hint('tiers-error', placed.tiers)}
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
            disabled={(sold.soldBySection.get(sec.id) ?? 0) > 0}
            onChange={(e) => {
              clearServer();
              setSectionType({ ...sectionType, [sec.id]: e.target.value });
            }}
            {...sectionProps(sec.id)}
          >
            {types.map((t, i) => (
              <option key={i} value={String(i)}>
                {t.name.trim() || `Ticket type ${i + 1}`}
              </option>
            ))}
            <option value="">Not for sale</option>
          </select>
          {(sold.soldBySection.get(sec.id) ?? 0) > 0 && (
            <span className="field__hint">{lockReason.section}</span>
          )}
        </div>
      ))}
      <div className="note">
        {types.map((t, i) => {
          const seats = l.sections
            .filter((sec) => sectionType[sec.id] === String(i))
            .reduce((n, sec) => n + sec.rows * sec.seatsPerRow, 0);
          // Spec 031 FR-010: a refused section list shows beside its type's seats line.
          return (
            <p key={i} data-testid={`seats-${i + 1}`}>
              {`${t.name.trim() || `Ticket type ${i + 1}`}: ${seats.toLocaleString()} ${seats === 1 ? 'seat' : 'seats'}`}{' '}
              {hint(`seats-${i + 1}-error`, typeHint(i, true))}
            </p>
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

      <div className="card">
        <form className="form" onSubmit={handleSubmit}>
          <fieldset className="field">
            <legend>Venue and times</legend>
            <div className="field">
              <label htmlFor="name">Event name</label>
              <input
                id="name"
                value={name}
                placeholder="Season Opener"
                onBlur={() => mark('name')}
                onChange={(e) => {
                  clearServer();
                  setName(e.target.value);
                }}
                {...fieldProps('name')}
              />
              {hint('name-error', fieldHint('name'))}
            </div>

            <div className="field">
              <label htmlFor="locationId">Venue</label>
              <select
                id="locationId"
                value={locationId}
                onBlur={() => mark('locationId')}
                onChange={(e) => {
                  clearServer();
                  setLocationId(e.target.value);
                  // Spec 020 FR-015: the typed times stay; a repeated hour is asked again.
                  setOccurrence({ startsAt: '', endsAt: '', doorsOpenAt: '' });
                  // Spec 036: in "Before the start" mode, recompute doors in the new venue's zone.
                  const next = venues.find((v) => v.id === e.target.value);
                  if (next) applyDoorsOffset(startsAt, '', next.timeZone ?? DEFAULT_TIME_ZONE);
                }}
                {...fieldProps('locationId')}
              >
                <option value="">Select a venue…</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.seatingCapacity.toLocaleString()} seats)
                  </option>
                ))}
              </select>
              {hint('locationId-error', fieldHint('locationId'))}
            </div>

            <fieldset className="field">
              <legend>Doors open</legend>
              <label className="choice">
                <input
                  type="radio"
                  name="doors-open-mode"
                  checked={doorsMode === 'before'}
                  onChange={() => {
                    clearServer();
                    switchDoorsMode('before');
                  }}
                />
                Before the start
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="doors-open-mode"
                  checked={doorsMode === 'at-time'}
                  onChange={() => {
                    clearServer();
                    switchDoorsMode('at-time');
                  }}
                />
                At a set time
              </label>
              {doorsMode === 'before' ? (
                <>
                  <div className="field">
                    <label htmlFor="doorsOpenOffset">How long before the start</label>
                    <select
                      id="doorsOpenOffset"
                      value={doorsOffsetMinutes ?? ''}
                      onBlur={() => mark('doorsOpenAt')}
                      onChange={(e) => {
                        clearServer();
                        const minutes = Number(e.target.value);
                        setDoorsOffsetMinutes(minutes);
                        setDoorsFromStart(startsAt, occurrence.startsAt, venueZone, minutes);
                      }}
                      {...fieldProps('doorsOpenAt')}
                      aria-describedby={[
                        fieldProps('doorsOpenAt')['aria-describedby'],
                        'doorsOpenAt-live',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {doorsOffsetMinutes == null ? (
                        <option value="" disabled>
                          Choose a length…
                        </option>
                      ) : null}
                      {doorsOffsetOptions().map((opt) => (
                        <option key={opt.minutes} value={opt.minutes}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* FR-016: mounted from the first render so the first value is announced. */}
                  <p className="note" id="doorsOpenAt-live" aria-live="polite">
                    {doorsLine ? <span data-testid="doorsOpenAt-preview">{doorsLine}</span> : null}
                  </p>
                </>
              ) : (
                <DateTimeFields
                  id="doorsOpenAt"
                  name="Doors open"
                  value={doorsOpenAt}
                  onBlur={() => mark('doorsOpenAt')}
                  onChange={(value) => {
                    clearServer();
                    setDoorsOpenAt(value);
                    setOccurrence((o) => ({ ...o, doorsOpenAt: '' }));
                  }}
                  fieldProps={fieldProps('doorsOpenAt')}
                />
              )}
              {doorsMode === 'at-time' ? timeNote('doorsOpenAt') : null}
              {doorsRangeNote()}
              {hint(
                'doorsOpenAt-error',
                fieldHint('doorsOpenAt').filter((m) => !timeChromeMessages().has(m)),
              )}
            </fieldset>
            <div className="field-row">
              <div className="field">
                <DateTimeFields
                  id="startsAt"
                  name="Starts"
                  value={startsAt}
                  onBlur={() => mark('startsAt')}
                  onChange={(value) => {
                    clearServer();
                    setStartsAt(value);
                    setOccurrence((o) => ({ ...o, startsAt: '' }));
                    applyDoorsOffset(value, '');
                  }}
                  fieldProps={fieldProps('startsAt')}
                />
                {timeNote('startsAt')}
                {hint(
                  'startsAt-error',
                  fieldHint('startsAt').filter((m) => !timeChromeMessages().has(m)),
                )}
              </div>
              <div className="field">
                <DateTimeFields
                  id="endsAt"
                  name="Ends"
                  value={endsAt}
                  onBlur={() => mark('endsAt')}
                  onChange={(value) => {
                    clearServer();
                    setEndsAt(value);
                    setOccurrence((o) => ({ ...o, endsAt: '' }));
                  }}
                  fieldProps={fieldProps('endsAt')}
                />
                {timeNote('endsAt')}
                {hint(
                  'endsAt-error',
                  fieldHint('endsAt').filter((m) => !timeChromeMessages().has(m)),
                )}
              </div>
            </div>
            <p className="note" data-testid="zone-line">
              {zoneLine()}
            </p>
            {timesRefusal && <ErrorBanner error={error!} />}
            {conflict && (
              <p data-testid="conflict-detail" className="conflict-detail">
                Conflicts with <strong>{conflict.name}</strong>, which runs{' '}
                {when(conflict.startsAt, venueZone)} –{' '}
                {until(conflict.startsAt, conflict.endsAt, venueZone)}. Pick a slot at least 60
                minutes clear of it, or choose another venue.
              </p>
            )}
          </fieldset>

          {Boolean(locationId) && typesLoaded && layoutReady && layout && (
            <fieldset className="field" id="tickets-and-seating">
              <legend>Tickets and seating</legend>
              <label className="choice">
                <input
                  type="radio"
                  name="plan"
                  checked={plan === 'reserved'}
                  disabled={sold.eventSold > 0}
                  onChange={() => {
                    clearServer();
                    setPlan('reserved');
                  }}
                  {...seatingProps}
                />
                Reserved seating
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="plan"
                  checked={plan === 'general'}
                  disabled={sold.eventSold > 0}
                  onChange={() => {
                    clearServer();
                    setPlan('general');
                  }}
                  {...seatingProps}
                />
                General admission
              </label>
              {sold.eventSold > 0 && <span className="field__hint">{lockReason.seating}</span>}
              {hint('seating-error', [
                ...placed.seating,
                ...(preview.get('tiers') ? [preview.get('tiers')!] : []),
              ])}
              {typeLines}
              {reserved && sectionSetup(layout)}
              <p className="note" data-testid="seat-total">
                {totals.summary}
                {totals.leftoverSentence ? ` ${totals.leftoverSentence}` : ''}
              </p>
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
                    onBlur={() => mark('totalTicketCapacity')}
                    onChange={(e) => {
                      clearServer();
                      setTotalTicketCapacity(e.target.value);
                    }}
                    {...fieldProps('totalTicketCapacity')}
                  />
                  <span className="field__hint">
                    {selected
                      ? `Up to ${selected.seatingCapacity.toLocaleString()} at ${selected.name}. `
                      : ''}
                    Leave blank to use the venue&apos;s capacity.
                  </span>
                  {hint('totalTicketCapacity-error', fieldHint('totalTicketCapacity'))}
                </div>
              )}
            </fieldset>
          )}
          {Boolean(locationId) && typesLoaded && layoutReady && !layout && (
            <fieldset className="field" id="tickets-and-seating" {...seatingProps}>
              <legend>Tickets and seating</legend>
              {hint('seating-error', [
                ...placed.seating,
                ...(preview.get('tiers') ? [preview.get('tiers')!] : []),
              ])}
              {typeLines}
              <p className="note" data-testid="seat-total">
                {totals.summary}
                {totals.leftoverSentence ? ` ${totals.leftoverSentence}` : ''}
              </p>
              {seated ? (
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
                    onBlur={() => mark('totalTicketCapacity')}
                    onChange={(e) => {
                      clearServer();
                      setTotalTicketCapacity(e.target.value);
                    }}
                    {...fieldProps('totalTicketCapacity')}
                  />
                  <span className="field__hint">
                    {selected
                      ? `Up to ${selected.seatingCapacity.toLocaleString()} at ${selected.name}. `
                      : ''}
                    Leave blank to use the venue&apos;s capacity.
                  </span>
                  {hint('totalTicketCapacity-error', fieldHint('totalTicketCapacity'))}
                </div>
              )}
            </fieldset>
          )}
          {typesFailed && (
            <p className="note">
              This event&apos;s ticket types could not be loaded, so saving changes only the details
              above.
            </p>
          )}
          {isEdit && seated && !(typesLoaded && layoutReady) && (
            <p className="note">
              {`Total tickets: ${Number(totalTicketCapacity).toLocaleString()}, set by the venue's seating layout.`}
            </p>
          )}

          <fieldset className="field">
            <legend>Details</legend>
            <div className="field">
              <label htmlFor="maxTicketsPerCustomer">Tickets per customer</label>
              <input
                id="maxTicketsPerCustomer"
                type="number"
                min={1}
                step={1}
                value={maxPerCustomer}
                onBlur={() => mark('maxTicketsPerCustomer')}
                onChange={(e) => {
                  clearServer();
                  setMaxPerCustomer(e.target.value);
                }}
                onInvalid={(e) => {
                  e.preventDefault();
                  mark('maxTicketsPerCustomer');
                  setSubmitted(true);
                }}
                {...fieldProps('maxTicketsPerCustomer')}
              />
              <span className="field__hint">Leave blank for no limit.</span>
              {hint('maxTicketsPerCustomer-error', fieldHint('maxTicketsPerCustomer'))}
            </div>

            <ImagesField
              eventId={id}
              items={images}
              onAdd={addImages}
              onMove={moveImage}
              onRemove={removeImage}
            />
          </fieldset>

          {noAnswer && (
            <div role="alert" data-testid="no-answer" className="banner banner--error">
              <span className="banner__icon" aria-hidden="true">
                ✕
              </span>
              <div className="banner__body">
                <strong>Could not save</strong>
                <p>
                  No answer from QueuePass, so the event may or may not have been scheduled. Check
                  the <Link to="/events">Events list</Link> before scheduling it again.
                </p>
              </div>
            </div>
          )}
          {!timesRefusal && placed.unmapped.length > 0 && (
            <p className="field__hint" role="alert" data-testid="submit-error">
              {placed.unmapped.join(' ')}
            </p>
          )}
          <p
            aria-live="polite"
            data-testid="form-status"
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              overflow: 'hidden',
              clip: 'rect(0 0 0 0)',
            }}
          >
            {live}
          </p>

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
