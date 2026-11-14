import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ORDER_LIMITS,
  RESERVATION_LIMITS,
  holderNameMessage,
  holderNameProblem,
  rateLimitMessage,
  type Availability,
  type ErrorEnvelope,
  type Event,
  type TicketTier,
  formatViewerTime,
} from '@queuepass/shared';
import {
  SectionsList,
  VenueMap,
  useAuth,
  usePriceFilter,
  useSeatStream,
  type MapLevel,
  type MapSeat,
  type SeatView,
  type StreamVenueMap,
} from '@queuepass/shared/web';
import {
  cents,
  count,
  eventPrice,
  seatLabel,
  seatWithPrice,
  startedNotice,
  sumUsd,
  totalUsd,
  usd,
} from '../format';
import type { ChosenSeat, Reservation } from '../seats';
import { useBuy, useWaits, type Wait } from '../use-buy';
import { placeKey, useHoldQueue, type QueuedAction } from '../use-hold-queue';
import { useLoad } from '../use-load';
import { HoldCountdown, ONE_MINUTE_LEFT, clock } from './HoldCountdown';
import { OrderConfirmation } from './OrderConfirmation';

/** A seat as a refusal's details name it: its section's name, numbers, and labels if given. */
type NamedSeat = Parameters<typeof seatLabel>[0];

/** Spec 033 research R10: the hold log keeps this many lines, cleared this long after the last. */
const LOG_LINES = 5;
const LOG_CLEAR_MS = 10_000;

/**
 * Spec 026 FR-011, FR-013: the countdown, directly above the control it explains, not announced
 * each second (aria-live off). The refusal is announced once, by the component's one live region,
 * not here: this may unmount and mount again during a wait, and an alert of its own would then be
 * said again (independent review, M2, M3).
 */
export function WaitMessage({ wait }: { wait: Wait }) {
  return (
    <p className="banner banner--error" aria-live="off">
      {rateLimitMessage(wait.left)}
    </p>
  );
}

/**
 * Spec 033 FR-006 (research R4): when seats of an ended reservation can be held again, in the
 * customer's own time zone with its abbreviation (spec 020 FR-023).
 */
export function cooldownMessage(details: Record<string, unknown> | undefined): string {
  const waiting = (details?.seats ?? []) as NamedSeat[];
  const at = formatViewerTime(String(details?.availableAt));
  return (
    `Your reservation of ${waiting.map(seatLabel).join('; ')} ended less than 2 minutes ago. ` +
    `You can hold ${waiting.length === 1 ? 'it' : 'them'} again at ${at}.`
  );
}

/**
 * Spec 006 US1 and US2: choose a tier (or the base price), a quantity, see the exact total, and
 * confirm; or learn why tickets can't be had. Spec 038 (FR-021, FR-022, FR-024; research R14): a
 * seated event shows its price range and Choose seats, which opens the venue map in place (it
 * replaces `007`'s ticket type, section and seat grid); a section zoomed into shows its seats. Spec
 * 033 (research R6, R7, R9, R10): a click on an open seat holds it for 5 minutes at once and a
 * click on a held seat releases it, one request at a time in click order; the Your seats box shows
 * the countdown, each seat with its level and price, the total, and Add to cart, which opens the
 * cart, where the seats are bought. General admission is unchanged. The Backend decides every rule
 * (FR-003); the counts, taken seats, and countdown shown here are guidance. Spec 034 (research R4):
 * while the event is in progress, a notice at the top says so; every answer about what is left is
 * reported to the page through `onSales` (FR-017), never a load in progress, so the page keeps
 * the last answer while a reload runs or if it fails.
 */
export function GetTickets({
  event,
  onSales,
  onEventChanged,
}: {
  event: Event;
  onSales?: (answer: Availability) => void;
  /** Spec 038 FR-010: the event as read again after its venue map went, now general admission. */
  onEventChanged?: (event: Event) => void;
}) {
  const { api, signIn, accessToken } = useAuth();
  const navigate = useNavigate();
  const id = event.id;
  const seatedEvent = event.reservedSeating;
  // Bumped after a refusal, so what is left is loaded again.
  const [reloads, setReloads] = useState(0);
  const availability = useLoad<Availability>(`availability:${id}:${reloads}`, (a) =>
    a.GET('/events/{id}/availability', { params: { path: { id } } }),
  );
  const tiers = useLoad<TicketTier[]>(`tiers:${id}`, (a) =>
    a.GET('/events/{id}/tiers', { params: { path: { id } } }),
  );
  // Spec 038 (research R14): Choose seats opens the map; the section zoomed into, whose seats are
  // loaded and kept current.
  const [mapOpen, setMapOpen] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  // Spec 015 FR-010 (research R9), spec 038 R12: only a seated event has a venue map, kept live,
  // with the customer's own reservations (`mine`), which a change to one of them reloads.
  const onSnapshot = useRef<(map: StreamVenueMap) => void>(() => undefined);
  const live = useSeatStream(seatedEvent ? id : null, {
    api,
    getToken: accessToken,
    withMine: true,
    openSectionId: openSection,
    onSnapshot: (map) => onSnapshot.current(map),
  });
  // Spec 038 FR-010: a seated event whose venue map is gone (`404`, from the map or the stream)
  // was deleted or switched to general admission; the two answer alike, so the event is read again
  // to tell them apart. Now general admission, the page shows it as such (`onEventChanged`).
  const [mapGone, setMapGone] = useState<'checking' | 'deleted' | 'unavailable' | null>(null);
  const reportEvent = useRef(onEventChanged);
  reportEvent.current = onEventChanged;
  useEffect(() => {
    if (!seatedEvent || live.status !== 'missing') return;
    let cancelled = false;
    setMapGone('checking');
    void api
      .GET('/events/{id}', { params: { path: { id } } })
      .then(({ data, response }) => {
        if (cancelled) return;
        if (response.status === 404) setMapGone('deleted');
        else if (data && !data.reservedSeating && reportEvent.current) reportEvent.current(data);
        else setMapGone('unavailable');
      })
      .catch(() => {
        if (!cancelled) setMapGone('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [api, id, seatedEvent, live.status]);
  // Spec 038 FR-017, FR-020: one price filter for the map and the Sections list.
  const [range, setRange] = usePriceFilter(live.map?.levels ?? NO_LEVELS);

  const [tierId, setTierId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  // Spec 017 FR-001 (research R2, R12): the buyer's name, on every ticket of a general-admission
  // order; a seated event asks for it in the cart (spec 033 FR-013).
  const [holderName, setHolderName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  // FR-006: the Backend's reason for the last refusal, in its own words.
  const [notice, setNotice] = useState<string | null>(null);
  // Spec 015: the customer's active reservation for this event, and the countdown to its end.
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [ranOut, setRanOut] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  // Spec 033 FR-016 (research R10): each hold and release said, appended, at most 5 lines.
  const [log, setLog] = useState<{ id: number; text: string }[]>([]);
  const logId = useRef(0);
  // Research R13: the deadline by this browser's monotonic clock, from the Backend's secondsLeft.
  const deadline = useRef<number | null>(null);
  const warned = useRef(false);
  // Seats this customer released since the section last changed: open, though it still says held.
  const [releasedHere, setReleasedHere] = useState<string[]>([]);
  // Seats a hold was refused for as taken, before the section shows it: shown held (spec 015
  // FR-012). Every seat stays focusable, marked aria-disabled when it can't be chosen.
  const [refusedTaken, setRefusedTaken] = useState<string[]>([]);
  // Spec 026 (research R6): the waits out of refusals for the limit, buying and holding apart.
  const waits = useWaits();
  const buyer = useBuy(id, waits);
  const phase = buyer.phase;
  // FR-013: the buttons a buy wait applies to, so focus can go back to the one pressed.
  const confirmOrderButton = useRef<HTMLButtonElement>(null);
  const checkAgainButton = useRef<HTMLButtonElement>(null);

  /** Spec 033 research R10: one more line in the hold log. */
  const say = (text: string): void => {
    logId.current += 1;
    const line = { id: logId.current, text };
    setLog((all) => [...all, line].slice(-LOG_LINES));
  };
  useEffect(() => {
    if (log.length === 0) return;
    const timer = setTimeout(() => setLog([]), LOG_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [log]);

  /**
   * Shows a reservation; the countdown starts only for a new one, never restarts while it lasts
   * (FR-004; spec 033 FR-003, FR-004).
   */
  const adopt = useCallback((r: Reservation | null, created = false) => {
    const before = reservationRef.current;
    setReservation(r);
    reservationRef.current = r;
    if (!r) {
      deadline.current = null;
      setSecondsLeft(null);
      return;
    }
    // Spec 038 (research R14): seats held, so the map stays open after they are released.
    setMapOpen(true);
    if (created || deadline.current === null || before?.createdAt !== r.createdAt) {
      deadline.current = performance.now() + r.secondsLeft * 1000;
      warned.current = false;
      setWarning(null);
      setSecondsLeft(r.secondsLeft);
    }
    setRanOut(false);
  }, []);

  const reservationRef = useRef<Reservation | null>(null);
  // What is left and the tiers, as last loaded: a reload keeps them on screen meanwhile, and if
  // it fails, so the form is never redrawn after the first load (review rounds 2 and 3, S1).
  const lastAvailability = useRef<Availability | null>(null);
  if (availability.kind === 'ok') lastAvailability.current = availability.data;
  // Spec 034 FR-009 (research R4): when the answer shown was loaded, the reference instant for
  // the notice's times, kept with it while a reload runs.
  const loadedAt = useRef<{ answer: Availability | null; at: number }>({ answer: null, at: 0 });
  if (availability.kind === 'ok' && loadedAt.current.answer !== availability.data) {
    loadedAt.current = { answer: availability.data, at: Date.now() };
  }
  // Spec 034 FR-017: each answer, once, to the page; before the browser paints, so the page's
  // ended line never shows beside a panel that already says the event is in progress.
  const reportSales = useRef(onSales);
  reportSales.current = onSales;
  const answer = availability.kind === 'ok' ? availability.data : null;
  useLayoutEffect(() => {
    if (answer) reportSales.current?.(answer);
  }, [answer]);
  const lastTiers = useRef<TicketTier[] | null>(null);
  if (tiers.kind === 'ok') lastTiers.current = tiers.data;
  // When this tab last changed its reservation; a list requested before that is out of date.
  const lastWrite = useRef(0);
  const { reloadMine } = live;

  /**
   * Loads what is left, and the venue map and open section, again, never redrawing the form: the
   * map shown stays until the answer (spec 033 review round 2, S1; spec 038 R12's `seq` keeps a
   * change that came meanwhile).
   */
  const refresh = (): void => {
    setReloads((n) => n + 1);
    if (seatedEvent) live.refresh();
  };

  // Spec 033 FR-007 (research R6): the click queue, and what each answer means here.
  const queue = useHoldQueue(id, {
    isHeld: (seat) =>
      (reservationRef.current?.seats ?? []).some((s) => placeKey(s) === placeKey(seat)),
    onDone: (action, r, created) => {
      lastWrite.current = performance.now();
      if (action.kind === 'release') {
        setReleasedHere((all) => [...all, placeKey(action.seat)]);
      }
      adopt(r, created);
      if (action.kind === 'hold') {
        const left =
          deadline.current === null
            ? (r?.secondsLeft ?? 0)
            : Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
        say(`${seatLabel(action.seat)} held. ${clock(left)} left.`);
      } else if (r) {
        say(`${seatLabel(action.seat)} released.`);
      } else {
        say(
          `${seatLabel(action.seat)} released. You hold no seats now; the next seat you click ` +
            'starts a new 5 minutes.',
        );
      }
    },
    onRefused: (action, error) => holdRefused(action, error),
    onLimited: (_action, seconds) => waits.start('HOLD', seconds),
    onNoAnswer: (action) => {
      // Spec 033 edge case "No answer": the seat goes back; what is true is loaded again, so a
      // hold that did go through shows as held.
      setNotice(`Your click on ${seatLabel(action.seat)} didn't go through. Try again.`);
      reloadMine();
      live.refresh();
    },
    onSignedOut: () => void signIn(),
  });

  /** Spec 033 FR-016: a refused click, as an alert naming the seat and the reason. */
  function holdRefused(action: QueuedAction, error: ErrorEnvelope | undefined): void {
    const e = error?.error;
    if (action.kind === 'release') {
      setNotice(e?.message ?? `${seatLabel(action.seat)} couldn't be released.`);
      reloadMine();
      return;
    }
    if (e?.code === 'SEAT_TAKEN' || e?.code === 'SEAT_OFF_SALE') {
      // Spec 007 US3-2, spec 015 US1-2, spec 038 FR-013: the seat is someone else's, or no longer
      // on sale. Its live change may have come while this hold was pending, so it is marked here:
      // shown as taken, it stays focusable (aria-disabled), and the focus stays on it (015
      // FR-012, spec 033 FR-016; review round 1, M1).
      setNotice(e.message);
      const named = ((e.details?.seats ?? []) as NamedSeat[]).flatMap((s) => {
        const at = live.map?.sections.find((x) => x.name === s.section);
        return at ? [placeKey({ sectionId: at.sectionId, row: s.row, seat: s.seat })] : [];
      });
      setRefusedTaken((all) => [...new Set([...all, placeKey(action.seat), ...named])]);
      // A live map already shows it; otherwise the map is read again, kept on screen meanwhile.
      if (live.status !== 'live') refresh();
    } else if (e?.code === 'SEAT_COOLDOWN') {
      setNotice(cooldownMessage(e.details));
    } else {
      setNotice(e?.message ?? `${seatLabel(action.seat)} couldn't be held.`);
    }
  }

  /**
   * Research R8, R13: the Backend's view of this customer's reservation, loaded on open and again
   * whenever a live change touches it, so another tab, an admin change, or the end of the 5
   * minutes is reflected here.
   */
  useEffect(() => {
    if (live.mine === null || live.mineAt < lastWrite.current) return;
    const found = live.mine.find((r) => r.eventId === id) ?? null;
    const local = reservationRef.current;
    if (found || !local) {
      adopt(found);
      return;
    }
    // It ended on the Backend. Close to the end of the 5 minutes, that is the run-out the
    // countdown is about to show; otherwise it was released elsewhere or by an admin change.
    const left = deadline.current === null ? 0 : deadline.current - performance.now();
    if (left <= 2_000) {
      deadline.current = performance.now();
      return;
    }
    adopt(null);
    say('Your held seats were released.');
  }, [live.mine, live.mineAt, id, adopt]);

  // What this page knows ahead of the section's seats lasts until they next change.
  useEffect(() => {
    setReleasedHere([]);
    setRefusedTaken([]);
  }, [live.section]);

  // Spec 038 research R12: a venue map after a reconnect may follow a price or layout change (the
  // stream ends on them), so what is left and the held seats' prices are read again.
  const mapsSeen = useRef(0);
  onSnapshot.current = (): void => {
    mapsSeen.current += 1;
    if (mapsSeen.current === 1) return;
    setReloads((n) => n + 1);
    reloadMine();
  };

  // FR-005, FR-012: the countdown, a single 1-minute warning, and the end of the 5 minutes.
  useEffect(() => {
    if (!reservation) return;
    const tick = (): void => {
      if (deadline.current === null) return;
      const left = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
      setSecondsLeft(left);
      if (left > 0 && left <= 60 && !warned.current) {
        warned.current = true;
        setWarning(ONE_MINUTE_LEFT);
      }
      if (left === 0) {
        deadline.current = null;
        reservationRef.current = null;
        setReservation(null);
        setSecondsLeft(null);
        setNotice(null);
        setRanOut(true);
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [reservation]);

  // Before the first map the form is not shown, so no click reads the map; the stream (or a
  // reload of the page) is what brings it. So these look at the stream's map alone (review
  // round 3, N2).
  const seatsLoading =
    seatedEvent && live.map === null && (live.status === 'loading' || live.status === 'connecting');
  const seatsFailed = seatedEvent && live.map === null && !seatsLoading;
  // A reload in flight, or one that failed, keeps the last good answer (review round 3, N3).
  const leftNow = availability.kind === 'ok' ? availability.data : lastAvailability.current;
  const tiersNow = tiers.kind === 'ok' ? tiers.data : lastTiers.current;
  const gone = seatedEvent && live.status === 'missing';
  if (
    (availability.kind === 'loading' && leftNow === null) ||
    (tiers.kind === 'loading' && tiersNow === null) ||
    seatsLoading ||
    (gone && mapGone !== 'deleted' && mapGone !== 'unavailable')
  ) {
    return <p>Loading tickets…</p>;
  }
  // Spec 015 edge case "Event deleted": its stream ended and a reconnect found no event.
  if (gone && mapGone === 'deleted') {
    return <p className="banner banner--error">This event no longer exists.</p>;
  }
  if (leftNow === null || tiersNow === null || seatsFailed || gone) {
    // Spec 012 FR-010: an error, so the theme's error banner; no role added, as before.
    return (
      <p className="banner banner--error">
        Ticket information is unavailable right now. Try again later.
      </p>
    );
  }

  const left = leftNow;
  const tierList = tiersNow;
  const tierLeft = (tid: string): number =>
    left.tiers.find((t) => t.tierId === tid)?.ticketsLeft ?? 0;
  const chosen = tierList.find((t) => t.id === tierId) ?? null;
  const ticketsLeft = chosen ? tierLeft(chosen.id) : left.ticketsLeft;
  // Spec 016 research R8: the customer's own limit; missing means none (research R9).
  const limit = left.customerLimit ?? null;
  const maxQuantity = Math.max(
    1,
    Math.min(ORDER_LIMITS.maxQuantity, ticketsLeft, limit?.remaining ?? Infinity),
  );
  // Spec 016 US4-3: why no more seats can be chosen, when the limit is what stops them. On a tie
  // with the tickets left the limit does not bind, as the Backend answers SOLD_OUT (research R3).
  const limitBinds =
    limit !== null && limit.remaining <= ORDER_LIMITS.maxQuantity && limit.remaining < ticketsLeft;
  const price = tierList.length > 0 ? chosen?.price : event.basePrice;
  const seated = seatedEvent ? live.map : null;
  const mine = new Set((reservation?.seats ?? []).map(placeKey));
  // Spec 033: the seats held once every queued click is answered.
  const willHold = new Set(mine);
  for (const [key, action] of queue.pending) {
    if (action === 'hold') willHold.add(key);
    else willHold.delete(key);
  }
  const chosenCount = seated ? willHold.size : Math.min(quantity, maxQuantity);
  const full = chosenCount >= maxQuantity;
  // Spec 038 (research R14): the map is open once asked for, and while seats are held or being
  // held (coming back from the cart's Change seats).
  const showMap = mapOpen || reservation !== null || queue.busy;
  // Spec 017 FR-001: no order without a valid name.
  const nameProblem = holderNameProblem(holderName);
  // The shared message, shown once the field was left (research R2).
  const nameError = nameTouched && nameProblem !== null ? holderNameMessage(nameProblem) : null;
  const canConfirm =
    price !== undefined &&
    ticketsLeft > 0 &&
    chosenCount > 0 &&
    nameProblem === null &&
    phase.kind === 'choosing';

  const choose = (change: () => void): void => {
    change();
    buyer.reset();
  };
  /** Spec 033 FR-001: a click on a seat holds it, or releases it if held. */
  const toggleSeat = (seat: ChosenSeat): void => {
    setNotice(null);
    setRanOut(false);
    queue.click(seat);
  };

  /**
   * Spec 038 FR-019, FR-021 (spec 033 FR-001, FR-009): how the map shows each seat. The
   * customer's own and those with a click still to be answered look selected; a seat released here
   * is open, and one refused as taken is held, until the section next changes. Only an open seat
   * can be held, and none while the hold allowance is waited out or no more seats can be had;
   * the customer's own can always be released.
   */
  const seatView = (seat: MapSeat): SeatView => {
    const key = placeKey(seat);
    const waiting = queue.pending.get(key);
    if (waiting === 'hold') return { shown: 'holding', disabled: false };
    if (waiting === 'release') return { shown: 'releasing', disabled: false };
    if (mine.has(key)) return { shown: 'mine', disabled: false };
    let shown: SeatView['shown'] = seat.state;
    if (shown === 'reserved' && releasedHere.includes(key)) shown = 'open';
    if (shown === 'open' && refusedTaken.includes(key)) shown = 'reserved';
    return { shown, disabled: shown !== 'open' || waits.waits.HOLD !== undefined || full };
  };

  /** Spec 006: Confirm order, for general admission. */
  async function confirm(): Promise<void> {
    const pressed = phase.kind === 'unknown' ? checkAgainButton : confirmOrderButton;
    const outcome = await buyer.buy(
      { ...(chosen ? { tierId: chosen.id } : {}), holderName, quantity: chosenCount },
      pressed,
    );
    if (outcome.kind === 'done') setNotice(null);
    if (outcome.kind === 'refused') {
      // Refused: nothing was recorded; what is left is loaded again (FR-006).
      setNotice(outcome.error?.error?.message ?? 'The request was refused.');
      refresh();
    }
  }

  if (phase.kind === 'done')
    return <OrderConfirmation eventName={event.name} order={phase.order} event={event} />;

  const closedBadge =
    left.salesClosed === 'CANCELLED'
      ? 'Cancelled'
      : left.salesClosed === 'ENDED'
        ? 'Sales closed'
        : left.ticketsLeft === 0
          ? 'Sold out'
          : 'Not on sale';
  const closed =
    left.salesClosed === 'CANCELLED'
      ? 'No tickets: this event has been cancelled.'
      : left.salesClosed === 'ENDED'
        ? 'Sales closed: this event has ended.'
        : left.ticketsLeft === 0
          ? 'Sold out: no tickets are left for this event.'
          : null;
  // Spec 016 FR-014: after the closed messages, which apply to every customer.
  const reached =
    !closed && limit !== null && limit.remaining === 0
      ? `You have reached the limit of ${tickets(limit.limit)} for this event.`
      : null;
  // Spec 034 FR-008, FR-010 (research R4): from the Backend's answer, never this browser's clock;
  // its first sentence alone when the panel shows a reason it offers no way to get tickets.
  const started =
    left.inProgress === true && left.salesClosed === null
      ? startedNotice(
          event.startsAt,
          event.endsAt,
          event.location.timeZone,
          loadedAt.current.at,
          closed || (reached && !reservation) ? 'first' : 'buy',
        )
      : null;

  return (
    <section className="card card--padded get-tickets" aria-labelledby="get-tickets">
      <h2 id="get-tickets">Get tickets</h2>
      {/* Spec 034 FR-008: a plain paragraph, read in order before the form (research R4). */}
      {started && <p className="note">{started}</p>}
      {/* Spec 026 FR-013 (independent review M2, M3): the one live region for refusals for the
          limit, always mounted, so each refusal is said once, when its text is set, and never
          again while that wait runs. An assertive region rather than role="alert", so it is not
          one of the page's alerts while it is empty. */}
      <p
        className="visually-hidden"
        aria-live="assertive"
        aria-atomic="true"
        data-announces="rate-limit"
      >
        {waits.announcement}
      </p>
      {/* Spec 008 FR-005: the lowest tier price, compared in whole cents. */}
      {tierList.length > 0 && (
        <p className="price">{`From ${usd(
          tierList.reduce(
            (lo, t) => (cents(t.price) < cents(lo) ? t.price : lo),
            tierList[0].price,
          ),
        )}`}</p>
      )}
      {/* Spec 012 FR-010: refusals and the unknown outcome as the shared theme's banners. */}
      {notice && (
        <p role="alert" className="banner banner--error">
          {notice}
        </p>
      )}
      {/* Spec 015 FR-005, FR-012; spec 033 FR-015: the end of the 5 minutes is an alert. */}
      {ranOut && (
        <p role="alert" className="banner banner--error">
          Your reservation ran out, so its seats were released. You can hold them again in 2 minutes
          if they are still open.
        </p>
      )}
      {phase.kind === 'unknown' || (phase.kind === 'confirming' && phase.checking) ? (
        <div role="alert" className="banner banner--conflict">
          <div className="banner__body">
            <p>We couldn&apos;t confirm whether your order went through.</p>
            <p>
              Check again, which never places a second order, or look for it in{' '}
              <Link to="/my-tickets">My tickets</Link>.
            </p>
            {waits.waits.BUY && <WaitMessage wait={waits.waits.BUY} />}
            <button
              ref={checkAgainButton}
              type="button"
              className="btn btn--ghost"
              aria-disabled={waits.waits.BUY ? true : undefined}
              onClick={() => void confirm()}
            >
              Check again
            </button>
          </div>
        </div>
      ) : closed ? (
        <>
          {/* Spec 008 US3-2: the status as a badge, beside the sentence that explains it. */}
          <p>
            <span className="pill pill--danger">{closedBadge}</span>
          </p>
          <p>{closed}</p>
        </>
      ) : reached && !reservation ? (
        <p className="banner banner--conflict">{reached}</p>
      ) : (
        chooseAndConfirm()
      )}
    </section>
  );

  /** A plain function, not a component, so the form is never remounted (focus stays put). */
  function chooseAndConfirm() {
    if (seated) return seatedForm(seated);
    return (
      <>
        {tierList.length > 0 ? (
          <fieldset>
            <legend>Ticket type</legend>
            {tierList.map((t) => (
              <label key={t.id} className="choice">
                <input
                  type="radio"
                  name="tier"
                  value={t.id}
                  checked={tierId === t.id}
                  disabled={tierLeft(t.id) === 0}
                  onChange={() => choose(() => setTierId(t.id))}
                />{' '}
                {tierLeft(t.id) === 0
                  ? `${t.name}, ${usd(t.price)}, sold out`
                  : `${t.name}, ${usd(t.price)}, ${count(tierLeft(t.id))} left`}
                {/* Spec 008 US3-2: hidden from the name, which already says it. */}
                {tierLeft(t.id) === 0 && (
                  <span className="pill pill--danger" aria-hidden="true">
                    Sold out
                  </span>
                )}
              </label>
            ))}
          </fieldset>
        ) : (
          <p>{`${usd(event.basePrice)} each, ${count(left.ticketsLeft)} left`}</p>
        )}
        {/* Spec 016 FR-012. */}
        {limitLine()}
        <>
          {nameField()}
          <label>
            Quantity{' '}
            <select
              value={Math.min(quantity, maxQuantity)}
              onChange={(e) => choose(() => setQuantity(Number(e.target.value)))}
            >
              {Array.from({ length: maxQuantity }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {price !== undefined && <p>{`Total: ${totalUsd(price, chosenCount)}`}</p>}
          {waits.waits.BUY && <WaitMessage wait={waits.waits.BUY} />}
          <button
            ref={confirmOrderButton}
            type="button"
            className="btn btn--primary"
            disabled={!canConfirm}
            aria-disabled={waits.waits.BUY ? true : undefined}
            onClick={() => void confirm()}
          >
            {phase.kind === 'confirming' ? 'Confirming…' : 'Confirm order'}
          </button>
        </>
      </>
    );
  }

  /** Spec 016 FR-012: the customer's limit and what is left of it. */
  function limitLine() {
    return (
      limit !== null && (
        <p className="note">{`Limit: ${tickets(limit.limit)} per customer. You can get ${limit.remaining} more.`}</p>
      )
    );
  }

  /** Spec 017 FR-001: one name, the buyer's own, on every ticket of a general-admission order. */
  function nameField() {
    return (
      // A shown error is linked to the field, so screen readers read it with the hint.
      <div className="holder-name">
        <label htmlFor="holder-name">Name on tickets</label>
        <input
          id="holder-name"
          type="text"
          value={holderName}
          autoComplete="name"
          aria-describedby={
            nameError !== null ? 'holder-name-hint holder-name-error' : 'holder-name-hint'
          }
          aria-invalid={nameError !== null ? true : undefined}
          onChange={(e) => choose(() => setHolderName(e.target.value))}
          onBlur={() => setNameTouched(true)}
        />
        <p id="holder-name-hint" className="note">
          Your name, as on the photo ID you&apos;ll show at the gate. It goes on every ticket.
        </p>
        {nameError !== null && (
          <p id="holder-name-error" className="banner banner--error">
            {nameError}
          </p>
        )}
      </div>
    );
  }

  /**
   * Spec 038 (FR-021, FR-024; research R14), spec 033 (FR-001, FR-009, FR-010, FR-016): the price
   * range and Choose seats; then the venue map (the only control for choosing seats), the hold wait
   * above it, the Your seats box directly below it, and the hold log.
   */
  function seatedForm(map: StreamVenueMap) {
    // A section gone from a new layout (the stream ended on the change) is closed.
    const shownSection = map.sections.some((x) => x.sectionId === openSection) ? openSection : null;
    const chooseSeat = (seat: MapSeat): void =>
      toggleSeat({
        sectionId: seat.sectionId,
        section: seat.section,
        row: seat.row,
        seat: seat.seat,
        rowLabel: seat.rowLabel,
        seatLabel: seat.seatLabel,
      });
    return (
      <>
        <p>{`${eventPrice(event)}, ${count(left.ticketsLeft)} ${
          left.ticketsLeft === 1 ? 'seat' : 'seats'
        } left`}</p>
        {limitLine()}
        {!showMap ? (
          <button type="button" className="btn btn--primary" onClick={() => setMapOpen(true)}>
            Choose seats
          </button>
        ) : (
          <>
            {limit !== null && limitBinds && full && (
              <p className="note">{`No more seats can be chosen: the limit of ${tickets(limit.limit)} per customer allows you ${limit.remaining} more.`}</p>
            )}
            {chosenCount >= RESERVATION_LIMITS.maxSeats && (
              <p className="note">{`A reservation holds at most ${RESERVATION_LIMITS.maxSeats} seats.`}</p>
            )}
            {/* Spec 026 FR-011, spec 033 FR-009: the hold wait, directly above the seats it holds
                back, which stay focusable (aria-disabled) and do nothing until it ends. */}
            {waits.waits.HOLD && <WaitMessage wait={waits.waits.HOLD} />}
            {/* Spec 038 FR-020 (research R13): the map and the Sections list, one state: the
                same open section, price filter, seat views and hold queue. */}
            <div className="venue-map-layout">
              <VenueMap
                map={map}
                colorBy="price"
                openSectionId={shownSection}
                section={live.section}
                onOpenSection={setOpenSection}
                range={range}
                onRange={setRange}
                seatView={seatView}
                onSeat={chooseSeat}
              />
              <SectionsList
                map={map}
                range={range}
                openSectionId={shownSection}
                section={live.section}
                onOpenSection={setOpenSection}
                seatView={seatView}
                onSeat={chooseSeat}
              />
            </div>
            {reservation && yourSeats(reservation)}
          </>
        )}
        {/* Spec 033 FR-016 (research R10): each hold and release, appended, so answers close
            together are each said, in order; not atomic, so only the new line is read. */}
        <div
          role="status"
          aria-atomic="false"
          data-announces="holds"
          className={log.length > 0 ? 'note' : undefined}
        >
          {log.map((line) => (
            <p key={line.id}>{line.text}</p>
          ))}
        </div>
      </>
    );
  }

  /**
   * Spec 033 FR-010, FR-011 (research R9): the countdown, the seats, the total, Add to cart. Spec
   * 038 FR-022: each seat with its level and price now, and their sum.
   */
  function yourSeats(r: Reservation) {
    return (
      <section className="note reservation" aria-labelledby="your-seats-heading">
        <h3 id="your-seats-heading">Your seats</h3>
        <HoldCountdown secondsLeft={secondsLeft ?? r.secondsLeft} warning={warning} />
        <ul aria-label="Held seats">
          {r.seats.map((s) => (
            <li key={placeKey(s)}>{seatWithPrice(s, s.levelName, s.price)}</li>
          ))}
        </ul>
        <p>{`Total: ${sumUsd(r.seats.map((s) => s.price))}`}</p>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/cart')}>
          Add to cart
        </button>
      </section>
    );
  }
}

const NO_LEVELS: readonly MapLevel[] = [];

const tickets = (n: number): string => `${n} ${n === 1 ? 'ticket' : 'tickets'}`;
