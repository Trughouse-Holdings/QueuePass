import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type {
  ConflictingEventRef,
  EventImage,
  EventInput,
  LayoutDetail,
  LayoutSectionSeats,
  LayoutSummary,
  Location,
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
import { getVenueLayout, getVenueLayoutSection, listVenueLayouts } from '../api/layouts';
import { getAvailability, getEventSeating, getVenueMapSection } from '../api/seating';
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
  type SeatingPreview,
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
  DEFAULT_EVENT_LENGTH_MINUTES,
  defaultEventInstants,
  doorsInstantBeforeStart,
  doorsModeForStoredGapMs,
  doorsOffsetOptions,
  doorsOpenAtPreview,
  isExactDoorsOffsetMinutes,
  type DoorsMode,
} from './event-form-times';
import { ErrorBanner } from '../components/ErrorBanner';
import { ImagesField, type ImageItem } from '../components/ImagesField';
import { countOffSale } from '../components/off-sale';
import { SeatingSection, type SeatingDraft, type TakenSeats } from '../components/SeatingSection';
import { SuccessState } from '../components/SuccessState';

/**
 * A venue-local value for `instant`, and which occurrence it is when that local time repeats
 * (spec 020). Used for the times the form fills in itself.
 */
function localWithOccurrence(instant: Date, zone: UsTimeZone): [string, Occurrence] {
  const local = toLocalDateTime(instant, zone);
  const r = resolveField(local, zone);
  if (r?.kind !== 'repeated') return [local, ''];
  return [local, toOffsetDateTime(instant, zone).slice(-6) === r.first.offset ? 'first' : 'second'];
}

/**
 * Spec 036 FR-017 (#160): a new event's Starts (the next whole hour), Ends (4 hours later), and
 * Doors open (036's default, 1 hour before the start), in `zone`.
 */
function newEventTimes(now: Date, zone: UsTimeZone) {
  const { startsAt, endsAt } = defaultEventInstants(now);
  const [start, startOcc] = localWithOccurrence(startsAt, zone);
  const [end, endOcc] = localWithOccurrence(endsAt, zone);
  const [doors, doorsOcc] = localWithOccurrence(
    doorsInstantBeforeStart(startsAt, DEFAULT_DOORS_OFFSET_MINUTES),
    zone,
  );
  return {
    startsAt: start,
    endsAt: end,
    doorsOpenAt: doors,
    occurrence: { startsAt: startOcc, endsAt: endOcc, doorsOpenAt: doorsOcc },
  };
}

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
 * One ticket type on the form (spec 008 US6, US7). `id` is set for a type the event already has.
 * Spec 038 (FR-012): only general admission has ticket types.
 */
type TicketType = { id?: string; name: string; price: string; quantity: string };

const NEW_TYPE: TicketType = { name: '', price: '', quantity: '' };

/** Spec 038: general admission, until a layout is chosen. */
const GENERAL: SeatingDraft = { layoutId: null, prices: {}, offSale: [] };

/** "45.5" → 4550, so prices compare as money rather than as text. */
const cents = (price: string): number => Math.round(Number(price.trim()) * 100);

/** Spec 008 R10: the event's base price is its lowest ticket type price. */
const lowestPrice = (types: TicketType[]): string =>
  types.reduce((low, t) => (cents(t.price) < cents(low.price) ? t : low)).price.trim();

/**
 * Spec 038 (research R9): a seated event's base price, its lowest on-sale level price, sent because
 * `EventInput` requires one; the Backend sets its own. `fallback` when no price is typed yet.
 */
const lowestLevelPrice = (prices: string[], fallback: string): string => {
  const typed = prices.map((p) => p.trim()).filter((p) => p !== '');
  return typed.length > 0
    ? typed.reduce((low, p) => (cents(p) < cents(low) ? p : low))
    : fallback || '0.00';
};

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
  // Spec 036 FR-017 (#160): a new event opens on today's next whole hour, 4 hours long, in the
  // default zone until a venue is chosen. An edit loads the stored times instead.
  const [defaults] = useState(() => (isEdit ? null : newEventTimes(new Date(), DEFAULT_TIME_ZONE)));
  // Spec 020 research R13: plain local strings, read in the chosen venue's zone.
  const [startsAt, setStartsAt] = useState(defaults?.startsAt ?? '');
  const [endsAt, setEndsAt] = useState(defaults?.endsAt ?? '');
  // FR-017: until the admin changes Starts, a venue in another zone recomputes the defaults; until
  // they change Ends, Ends follows the start, 4 hours later. An edit starts with both changed.
  const [startsTouched, setStartsTouched] = useState(isEdit);
  const [endsTouched, setEndsTouched] = useState(isEdit);
  // Spec 025 research R4, 036: Doors open, a local string like the start.
  const [doorsOpenAt, setDoorsOpenAt] = useState(defaults?.doorsOpenAt ?? '');
  // Spec 036: two ways to set doors open; a new event starts in "Before the start", 1 hour.
  const [doorsMode, setDoorsMode] = useState<DoorsMode>('before');
  const [doorsOffsetMinutes, setDoorsOffsetMinutes] = useState<number | null>(
    DEFAULT_DOORS_OFFSET_MINUTES,
  );
  /** Once a save was tried, the range message under Doors open is announced (role="alert"). */
  const [doorsChecked, setDoorsChecked] = useState(false);
  const [occurrence, setOccurrence] = useState<Record<TimeField, Occurrence>>(
    defaults?.occurrence ?? { startsAt: '', endsAt: '', doorsOpenAt: '' },
  );
  const [totalTicketCapacity, setTotalTicketCapacity] = useState('');
  // Spec 016 FR-008: blank is no limit.
  const [maxPerCustomer, setMaxPerCustomer] = useState('');
  // Spec 038 (FR-014): an edited event that has a layout; its capacity is its seats on sale.
  const [eventSeated, setEventSeated] = useState(false);
  /** The event's stored base price, kept when its ticket types could not be loaded. */
  const [storedBasePrice, setStoredBasePrice] = useState('');
  // Spec 038 US2 (FR-010, FR-015; research R8, R15): the venue's layouts, and the event's seating:
  // general admission or a layout, its level prices and its seats off sale, sent with the event.
  const [venueLayouts, setVenueLayouts] = useState<LayoutSummary[]>([]);
  const [layoutsReady, setLayoutsReady] = useState(false);
  const [seating, setSeating] = useState<SeatingDraft>(GENERAL);
  /** The layout the edited event has saved; `null` for general admission or a new event. */
  const [storedLayoutId, setStoredLayoutId] = useState<string | null>(null);
  /** On edit, `getEventSeating` could not be read: only the details are saved. */
  const [seatingMissing, setSeatingMissing] = useState(false);
  const [detail, setDetail] = useState<LayoutDetail | null>(null);
  const [sectionSeats, setSectionSeats] = useState<Record<string, LayoutSectionSeats>>({});
  const [taken, setTaken] = useState<Record<string, TakenSeats>>({});
  /** FR-015: the event the price boxes were started from, after a layout was chosen. */
  const [pricesFrom, setPricesFrom] = useState<string | null>(null);
  /** A layout was just chosen: its latest prices fill the boxes once it loads. */
  const seedPrices = useRef(false);
  const requested = useRef<Set<string>>(new Set());
  const [types, setTypes] = useState<TicketType[]>([NEW_TYPE]);
  const [typesLoaded, setTypesLoaded] = useState(!id);
  const [typesFailed, setTypesFailed] = useState(false);
  // Spec 035 (research R5): a field shows its preview error after it is left, then as the admin types.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [live, setLive] = useState('');
  const announced = useRef<Set<string>>(new Set());
  const EMPTY_SOLD: SoldCounts = { eventSold: 0, soldByTier: new Map() };
  const [sold, setSold] = useState<SoldCounts>(EMPTY_SOLD);
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

  // Spec 038 (FR-010): the venue's layouts to choose from; a venue without any is general admission.
  useEffect(() => {
    setLayoutsReady(false);
    if (!locationId) return;
    let cancelled = false;
    listVenueLayouts(locationId)
      .then((list) => !cancelled && setVenueLayouts(list))
      .catch(() => !cancelled && setVenueLayouts([]))
      .finally(() => !cancelled && setLayoutsReady(true));
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  // The chosen layout's levels and sections; a layout just chosen starts its price boxes from the
  // prices of the event most recently scheduled on it (FR-015).
  useEffect(() => {
    setDetail(null);
    if (!seating.layoutId) return;
    let cancelled = false;
    getVenueLayout(seating.layoutId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        if (!seedPrices.current) return;
        seedPrices.current = false;
        if (!d.latestPrices) return;
        const latest = d.latestPrices;
        setSeating((now) =>
          now.layoutId === d.id
            ? { ...now, prices: Object.fromEntries(latest.prices.map((p) => [p.levelId, p.price])) }
            : now,
        );
        setPricesFrom(latest.eventName);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [seating.layoutId]);

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
        setEventSeated(e.layoutId != null || e.reservedSeating);
        setStoredBasePrice(e.basePrice);
      })
      .catch((err: ApiError) => setError(err));
    // Spec 008 US7 (R10): the event's ticket types. Spec 038 (research R8): its seating.
    Promise.all([
      listTiers(id),
      getEventSeating(id).catch(() => null),
      getAvailability(id).catch(() => null),
    ])
      .then(([tiers, saved, availability]) => {
        const loaded = tiers.map((t) => ({
          id: t.id,
          name: t.name,
          price: t.price,
          quantity: String(t.quantity),
        }));
        setTypes(loaded.length > 0 ? loaded : [NEW_TYPE]);
        setTypesLoaded(true);
        setSeatingMissing(saved === null);
        if (saved?.layoutId) {
          setStoredLayoutId(saved.layoutId);
          setSeating({
            layoutId: saved.layoutId,
            prices: Object.fromEntries(
              saved.levels.flatMap((l) => (l.price === null ? [] : [[l.levelId, l.price]])),
            ),
            offSale: saved.offSale,
          });
        }
        if (!availability) return;
        // Spec 038 FR-010: a seated event's sales are its seats on sale less the tickets left.
        const leftByTier = new Map(availability.tiers.map((row) => [row.tierId, row.ticketsLeft]));
        const soldByTier = new Map<string, number>();
        let eventSold = saved?.layoutId
          ? Math.max(0, saved.seatsOnSale - availability.ticketsLeft)
          : 0;
        for (const t of tiers) {
          const left = leftByTier.get(t.id);
          const soldCount = left == null ? 0 : Math.max(0, t.quantity - left);
          soldByTier.set(t.id, soldCount);
          eventSold += soldCount;
        }
        setSold({ eventSold, soldByTier });
      })
      // Without its ticket types the form saves the event's details alone.
      .catch(() => setTypesFailed(true));
  }, [id]);

  /** Spec 038: a layout is chosen; it has no ticket types (FR-012). */
  const seated = seating.layoutId !== null;
  /** The chosen layout as loaded (it may still be the previous one while the next loads). */
  const layoutDetail = detail && detail.id === seating.layoutId ? detail : null;
  /** FR-014: each level's seats off sale and the totals, from the selectors. */
  const counts = layoutDetail ? countOffSale(layoutDetail, seating.offSale, sectionSeats) : null;
  const onSaleOf = (levelId: string, seatCount: number): number =>
    seatCount - (counts?.offByLevel.get(levelId) ?? 0);
  /** The levels whose price boxes show, in rank order. */
  const pricedLevels = (layoutDetail?.levels ?? []).filter((l) => onSaleOf(l.id, l.seatCount) > 0);
  const levelIds = (layoutDetail?.levels ?? []).map((l) => l.id);
  /** On edit, the event's ticket types or seating could not be read: details only (as before). */
  const detailsOnly = !typesLoaded || (eventSeated && seatingMissing);
  /** What the preview checks need of a seated event (FR-011, FR-014). */
  const seatingPreview: SeatingPreview | null = !seated
    ? null
    : {
        seatsOnSale: counts?.seatsOnSale ?? layoutDetail?.seatCount ?? 1,
        levels: (layoutDetail?.levels ?? []).map((l) => ({
          id: l.id,
          name: l.name,
          onSale: onSaleOf(l.id, l.seatCount),
          price: seating.prices[l.id] ?? '',
        })),
      };

  /**
   * A section's seats, and on edit (the event's own layout) its sold and held seats, which the
   * off-sale tool can't take off sale (FR-013). Each is asked for once.
   */
  function loadSection(sectionId: string): void {
    const layoutId = seating.layoutId;
    if (!layoutId || requested.current.has(`${layoutId}/${sectionId}`)) return;
    requested.current.add(`${layoutId}/${sectionId}`);
    getVenueLayoutSection(layoutId, sectionId)
      .then((seats) => setSectionSeats((now) => ({ ...now, [sectionId]: seats })))
      .catch(() => requested.current.delete(`${layoutId}/${sectionId}`));
    if (id && layoutId === storedLayoutId) {
      getVenueMapSection(id, sectionId)
        .then((map) => {
          const states: TakenSeats = new Map();
          for (const row of map.rows) {
            for (const seat of row.seats) {
              if (seat.state === 'sold' || seat.state === 'reserved') {
                states.set(`${row.number}/${seat.number}`, seat.state);
              }
            }
          }
          setTaken((now) => ({ ...now, [sectionId]: states }));
        })
        // The Backend refuses a sold or held seat anyway (409 SEAT_TAKEN), shown beside the map.
        .catch(() => undefined);
    }
  }

  // Sections whose seats the counts by level need (a row or a seat off sale, or a section of
  // several levels), loaded as soon as they are named.
  const missingKey = (counts?.missing ?? []).join(',');
  useEffect(() => {
    for (const sectionId of counts?.missing ?? []) loadSection(sectionId);
  }, [missingKey, seating.layoutId]);

  /** Spec 038 (FR-015): another layout, or general admission; prices and seats off sale restart. */
  function chooseLayout(layoutId: string | null): void {
    seedPrices.current = layoutId !== null;
    requested.current = new Set();
    setSectionSeats({});
    setTaken({});
    setPricesFrom(null);
    setSeating({ ...GENERAL, layoutId });
  }

  /** A ticket type as the Backend takes it (general admission). */
  const tierInput = (t: TicketType) => ({
    name: t.name.trim(),
    price: t.price.trim(),
    quantity: Number(t.quantity),
  });

  /** Spec 038 (research R8): the seating fields of a seated event's request. */
  const seatingInput = () => ({
    layoutId: seating.layoutId!,
    levelPrices: pricedLevels.map((l) => ({
      levelId: l.id,
      price: (seating.prices[l.id] ?? '').trim(),
    })),
    offSale: seating.offSale,
  });

  /**
   * Spec 031 (research R4, R5): the event and its ticket types, or (spec 038) its layout, level
   * prices and seats off sale, in one request, which the Backend saves all or nothing.
   */
  async function scheduleEvent(payload: EventInput): Promise<string> {
    const created = await createEvent(
      seated ? { ...payload, ...seatingInput() } : { ...payload, tiers: types.map(tierInput) },
    );
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
   * Spec 035 FR-016 to FR-019 (research R8): one update request carries the event and its ticket
   * types or (spec 038) its seating, saved all or nothing. A seated event put back on general
   * admission sends `layoutId: null`. If the types or the seating could not be loaded, only the
   * details are sent, as before.
   */
  async function saveEvent(eventId: string, payload: EventInput): Promise<void> {
    if (detailsOnly) {
      await updateEvent(eventId, payload);
      return;
    }
    if (seated) {
      await updateEvent(eventId, { ...payload, ...seatingInput() });
      return;
    }
    await updateEvent(eventId, {
      ...payload,
      ...(storedLayoutId !== null ? { layoutId: null } : {}),
      tiers: types.map((t) => ({ ...(t.id ? { id: t.id } : {}), ...tierInput(t) })),
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
      seating: seatingPreview,
      totalTicketCapacity,
      venueCapacity: selected ? selected.seatingCapacity : null,
      maxPerCustomer,
      doorsFromStart: doorsMode === 'before' && doorsOffsetMinutes != null,
    });
    if (all.size > 0) {
      const first = firstErrorKey(all, types.length, levelIds);
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
      // FR-019: blank means the venue's capacity; seated events never send one (038 FR-014),
      // including one whose seating could not be loaded.
      ...(!seated && !(detailsOnly && eventSeated) && totalTicketCapacity.trim() !== ''
        ? { totalTicketCapacity: Number(totalTicketCapacity) }
        : {}),
      // Spec 016 research R7: an edit always sends it, so clearing it sends null.
      ...(limit !== ''
        ? { maxTicketsPerCustomer: Number(limit) }
        : isEdit
          ? { maxTicketsPerCustomer: null }
          : {}),
      // Spec 008 FR-019: no base price field; the event is priced from its ticket types. Spec 038
      // (R9): a seated event's is its lowest level price, which the Backend sets itself.
      basePrice: detailsOnly
        ? storedBasePrice
        : seated
          ? lowestLevelPrice(
              pricedLevels.map((l) => seating.prices[l.id] ?? ''),
              storedBasePrice,
            )
          : lowestPrice(types),
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
    const first = firstPlacedKey(fieldErrors(error), types.length, levelIds);
    if (!first) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(timeAwareFocusId(first))?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [error, types.length]);
  const typeErrors = (i: number): TypeFieldError[] => placed.types.get(i) ?? [];
  /** The type's input for `field` is invalid when a message names it, or names no known field. */
  const invalid = (i: number, field: string): boolean =>
    typeErrors(i).some((e) => e.field === field || !TYPE_FIELDS.includes(e.field));
  /** The seating hint, described by the tickets and seating group (FR-010). */
  const seatingProps = placed.seating.length > 0 ? { 'aria-describedby': 'seating-error' } : {};
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

  /** Spec 036 FR-017: until Ends is changed, it follows a start that names one moment, +4 h. */
  function followEnd(local: string, chosen: Occurrence, zone: UsTimeZone = venueZone): void {
    if (endsTouched) return;
    const r = resolveField(local, zone);
    const m = r ? momentOf(r, chosen) : null;
    if (!m) return;
    const [end, occ] = localWithOccurrence(
      new Date(m.instant.getTime() + DEFAULT_EVENT_LENGTH_MINUTES * 60_000),
      zone,
    );
    setEndsAt(end);
    setOccurrence((o) => ({ ...o, endsAt: occ }));
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
      // FR-017: choosing which of a repeated time is a change to that field.
      if (field === 'startsAt') {
        setStartsTouched(true);
        applyDoorsOffset(startsAt, value);
        followEnd(startsAt, value);
      }
      if (field === 'endsAt') setEndsTouched(true);
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
    seating: seatingPreview,
    totalTicketCapacity,
    venueCapacity: selected ? selected.seatingCapacity : null,
    maxPerCustomer,
    doorsFromStart: doorsMode === 'before' && doorsOffsetMinutes != null,
  });
  const preview = visibleErrors(previewAll, touched, submitted);
  const totals = seatTotals({
    types,
    totalTicketCapacity,
    venueCapacity: selected ? selected.seatingCapacity : null,
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
  const typeHint = (i: number): string[] => {
    const server = typeErrors(i).map((e) => e.message);
    if (server.length > 0) return server;
    const keys = ['name', 'price', 'quantity'] as const;
    return keys.flatMap((field) =>
      preview.get(`tiers.${i}.${field}`) ? [preview.get(`tiers.${i}.${field}`)!] : [],
    );
  };

  const setType = (i: number, change: Partial<TicketType>) =>
    setTypes(types.map((t, j) => (j === i ? { ...t, ...change } : t)));
  const removeType = (i: number) => setTypes(types.filter((_, j) => j !== i));

  /** Spec 008 US7: a general-admission event's ticket types, each with a quantity. */
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
          {hint(`type-${i + 1}-error`, typeHint(i))}
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
                  // Spec 038 (R8): a layout is its venue's; another venue starts on general admission.
                  chooseLayout(null);
                  // Spec 020 FR-015: the typed times stay; a repeated hour is asked again.
                  setOccurrence({ startsAt: '', endsAt: '', doorsOpenAt: '' });
                  // Spec 036: in "Before the start" mode, recompute doors in the new venue's zone.
                  const next = venues.find((v) => v.id === e.target.value);
                  if (!next) return;
                  const zone = next.timeZone ?? DEFAULT_TIME_ZONE;
                  if (!isEdit && !startsTouched && !endsTouched && doorsMode === 'before') {
                    // Spec 036 FR-017: while no time has been changed, the defaults are
                    // recomputed in the venue's zone. Once one has, every typed time stays (020).
                    const fresh = newEventTimes(new Date(), zone);
                    setStartsAt(fresh.startsAt);
                    setEndsAt(fresh.endsAt);
                    setOccurrence((o) => ({
                      ...o,
                      startsAt: fresh.occurrence.startsAt,
                      endsAt: fresh.occurrence.endsAt,
                    }));
                    applyDoorsOffset(fresh.startsAt, fresh.occurrence.startsAt, zone);
                    return;
                  }
                  applyDoorsOffset(startsAt, '', zone);
                  followEnd(startsAt, '', zone);
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
                    setStartsTouched(true);
                    setOccurrence((o) => ({ ...o, startsAt: '' }));
                    applyDoorsOffset(value, '');
                    followEnd(value, '');
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
                    setEndsTouched(true);
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

          {Boolean(locationId) && typesLoaded && layoutsReady && (
            <fieldset className="field" id="tickets-and-seating" {...seatingProps}>
              <legend>Tickets and seating</legend>
              {hint('seating-error', [
                ...placed.seating,
                ...(preview.get('tiers') ? [preview.get('tiers')!] : []),
              ])}
              {(venueLayouts.length > 0 || seated) && (
                <SeatingSection
                  layouts={venueLayouts}
                  draft={seating}
                  detail={layoutDetail}
                  sections={sectionSeats}
                  taken={taken}
                  counts={counts}
                  lockedReason={
                    sold.eventSold > 0 ? (seated ? lockReason.layout : lockReason.seating) : null
                  }
                  pricesFrom={pricesFrom}
                  onLayout={(layoutId) => {
                    clearServer();
                    chooseLayout(layoutId);
                  }}
                  onPrice={(levelId, price) => {
                    clearServer();
                    setSeating((now) => ({ ...now, prices: { ...now.prices, [levelId]: price } }));
                  }}
                  onOffSale={(offSale) => {
                    clearServer();
                    setSeating((now) => ({ ...now, offSale }));
                  }}
                  onOpenSection={loadSection}
                  onBlur={mark}
                  hints={fieldHint}
                />
              )}
              {seated ? (
                <p className="note">
                  {`Total tickets: ${(counts?.seatsOnSale ?? layoutDetail?.seatCount ?? 0).toLocaleString()}, the seats on sale.`}
                </p>
              ) : (
                <>
                  {typeLines}
                  <p className="note" data-testid="seat-total">
                    {totals.summary}
                    {totals.leftoverSentence ? ` ${totals.leftoverSentence}` : ''}
                  </p>
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
                </>
              )}
            </fieldset>
          )}
          {(typesFailed || (isEdit && typesLoaded && detailsOnly)) && (
            <p className="note">
              This event&apos;s ticket types or seating could not be loaded, so saving changes only
              the details above.
            </p>
          )}
          {isEdit && eventSeated && detailsOnly && (
            <p className="note">
              {`Total tickets: ${Number(totalTicketCapacity).toLocaleString()}, the seats on sale.`}
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
