import { useCallback, useEffect, useRef, useState } from 'react';
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
  type Reservation,
  type SeatLabel,
  type TicketTier,
  formatViewerTime,
} from '@queuepass/shared';
import {
  useAuth,
  useSeatStream,
  type StreamSeatMap,
  type StreamSeatMapChange,
} from '@queuepass/shared/web';
import { cents, count, seatLabel, totalUsd, usd } from '../format';
import { useBuy, useWaits, type Wait } from '../use-buy';
import { placeKey, useHoldQueue, type QueuedAction } from '../use-hold-queue';
import { useLoad } from '../use-load';
import { HoldCountdown, ONE_MINUTE_LEFT, clock } from './HoldCountdown';
import { OrderConfirmation } from './OrderConfirmation';
import { SeatPicker, type ChosenSeat } from './SeatPicker';

const sameSeat = (a: SeatLabel, b: SeatLabel): boolean =>
  a.section === b.section && a.row === b.row && a.seat === b.seat;
const seatKey = (s: SeatLabel): string => `${s.section}-${s.row}-${s.seat}`;

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
  const waiting = (details?.seats ?? []) as SeatLabel[];
  const at = formatViewerTime(String(details?.availableAt));
  return (
    `Your reservation of ${waiting.map(seatLabel).join('; ')} ended less than 2 minutes ago. ` +
    `You can hold ${waiting.length === 1 ? 'it' : 'them'} again at ${at}.`
  );
}

/**
 * Spec 006 US1 and US2: choose a tier (or the base price), a quantity, see the exact total, and
 * confirm; or learn why tickets can't be had. Spec 007: for an event with reserved seating, choose
 * a tier, a section, and seats instead of a quantity. Spec 033 (research R6, R7, R9, R10; it
 * replaces `015` research R13's Reserve seats): a click on an open seat holds it for 5 minutes at
 * once and a click on a held seat releases it, one request at a time in click order; the Your
 * seats box shows the countdown, the seats, the total, and Add to cart, which opens the cart, where
 * the seats are bought. General admission is unchanged. The Backend decides every rule (FR-003);
 * the counts, taken seats, locks, and countdown shown here are guidance.
 */
export function GetTickets({ event }: { event: Event }) {
  const { api, signIn, accessToken } = useAuth();
  const navigate = useNavigate();
  const id = event.id;
  // Bumped after a refusal, so what is left is loaded again.
  const [reloads, setReloads] = useState(0);
  // Spec 015 FR-016: bumped when an admin change maps the sections to tiers anew, so the tiers and
  // what is left of each are loaded again, not kept from before the change (T046).
  const [seatings, setSeatings] = useState(0);
  const availability = useLoad<Availability>(`availability:${id}:${reloads}:${seatings}`, (a) =>
    a.GET('/events/{id}/availability', { params: { path: { id } } }),
  );
  const tiers = useLoad<TicketTier[]>(`tiers:${id}:${seatings}`, (a) =>
    a.GET('/events/{id}/tiers', { params: { path: { id } } }),
  );
  // Spec 007: only a seated event needs its seat map. Spec 015 FR-010 (research R9): kept live,
  // with the customer's own reservations (`mine`), which a change to one of them reloads.
  const onChange = useRef<(change: StreamSeatMapChange) => void>(() => undefined);
  const onSnapshot = useRef<(map: StreamSeatMap) => void>(() => undefined);
  const live = useSeatStream(event.reservedSeating ? id : null, {
    api,
    getToken: accessToken,
    withMine: true,
    onChange: (change) => onChange.current(change),
    onSnapshot: (map) => onSnapshot.current(map),
  });

  const [tierId, setTierId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  // Spec 017 FR-001 (research R2, R12): the buyer's name, on every ticket of a general-admission
  // order; a seated event asks for it in the cart (spec 033 FR-013).
  const [holderName, setHolderName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  // FR-006: the Backend's reason for the last refusal, in its own words.
  const [notice, setNotice] = useState<string | null>(null);
  // Spec 007: the chosen section (null: the first offered).
  const [sectionId, setSectionId] = useState<string | null>(null);
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
  // Seats this customer released since the map loaded: open, though the map still says reserved.
  const [releasedHere, setReleasedHere] = useState<string[]>([]);
  // FR-012: seats that became unavailable while shown. They stay focusable (aria-disabled).
  const [lateGone, setLateGone] = useState<string[]>([]);
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
    if (created || deadline.current === null || before?.createdAt !== r.createdAt) {
      ranOutSeats.current = [];
      deadline.current = performance.now() + r.secondsLeft * 1000;
      warned.current = false;
      setWarning(null);
      setSecondsLeft(r.secondsLeft);
    }
    if (r.tierId) setTierId(r.tierId);
    setRanOut(false);
  }, []);

  const reservationRef = useRef<Reservation | null>(null);
  // Spec 033 review round 2 (S1): the seat map read again by this page, shown over the stream's
  // until the stream next changes it. `live.reload()` would empty the map and redraw the form as
  // "Loading tickets…", dropping the keyboard focus, so this page never calls it.
  const [mapRead, setMapRead] = useState<StreamSeatMap | null>(null);
  useEffect(() => setMapRead(null), [live.map]);
  const seatMap = mapRead ?? live.map;
  const mapRef = useRef<StreamSeatMap | null>(null);
  mapRef.current = seatMap;
  // What is left and the tiers, as last loaded: a reload keeps them on screen meanwhile, so the
  // form is never redrawn after the first load (review round 2, S1).
  const lastAvailability = useRef<Availability | null>(null);
  if (availability.kind === 'ok') lastAvailability.current = availability.data;
  const lastTiers = useRef<TicketTier[] | null>(null);
  if (tiers.kind === 'ok') lastTiers.current = tiers.data;
  // The seats of a reservation whose countdown just ran out: the Backend may close it up to a
  // second later, and they are still this customer's until then.
  const ranOutSeats = useRef<string[]>([]);
  // When this tab last changed its reservation; a list requested before that is out of date.
  const lastWrite = useRef(0);
  const { reloadMine } = live;

  /** Reads the seat map again, keeping the one shown until the answer comes. */
  const readMap = async (): Promise<void> => {
    if (!event.reservedSeating) return;
    try {
      const { data, response } = await api.GET('/events/{id}/seats', { params: { path: { id } } });
      if (response.ok && data) setMapRead(data);
    } catch {
      // The stream, or the next refusal, brings it.
    }
  };

  /** Loads what is left, and the seat map, again, never redrawing the form. */
  const refresh = (): void => {
    setReloads((n) => n + 1);
    void readMap();
  };

  // Spec 033 FR-007 (research R6): the click queue, and what each answer means here.
  const queue = useHoldQueue(id, {
    isHeld: (seat) => (reservationRef.current?.seats ?? []).some((s) => sameSeat(s, seat)),
    onDone: (action, r, created) => {
      lastWrite.current = performance.now();
      if (action.kind === 'release') {
        setReleasedHere((all) => [...all, seatKey(action.seat)]);
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
      void readMap();
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
    if (e?.code === 'SEAT_TAKEN') {
      // Spec 007 US3-2, spec 015 US1-2: the seat is someone else's. Its live change may have come
      // while this hold was pending, when it was not someone else's yet, so it is marked here:
      // shown as taken, it stays focusable (aria-disabled), and the focus stays on it (015
      // FR-012, spec 033 FR-016; review round 1, M1).
      setNotice(e.message);
      const named = ((e.details?.seats ?? []) as SeatLabel[]).flatMap((s) => {
        const at = live.map?.sections.find((x) => x.name === s.section);
        return at ? [placeKey({ sectionId: at.sectionId, row: s.row, seat: s.seat })] : [];
      });
      setLateGone((all) => [...new Set([...all, placeKey(action.seat), ...named])]);
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

  useEffect(() => setReleasedHere([]), [live.map]);

  /** This customer's own seat: being held now, held, or from the reservation that ran out. */
  const isOwn = (c: { sectionId: string; row: number; seat: number }): boolean =>
    queue.pending.get(placeKey(c)) === 'hold' ||
    ranOutSeats.current.includes(placeKey(c)) ||
    (reservationRef.current?.seats ?? []).some((r) => placeKey(r) === placeKey(c));

  // A snapshot after a reconnect may show seats taken while the stream was down. The customer's
  // own seats are not taken by someone else, and a seat that was open before stays focusable
  // (FR-011, FR-012).
  onSnapshot.current = (map: StreamSeatMap): void => {
    const before = mapRef.current;
    // An admin change ends the stream (contract: streamSeatMap); the snapshot after it may map
    // the sections to other tiers, which changes the tiers and their counts too (FR-016, T046).
    const seating = (m: StreamSeatMap): string =>
      m.sections.map((s) => `${s.sectionId}:${s.tierId ?? ''}`).join(',');
    if (before && seating(before) !== seating(map)) setSeatings((n) => n + 1);
    const gone = map.sections
      .flatMap((s) => [...s.taken, ...s.reserved].map((p) => ({ sectionId: s.sectionId, ...p })))
      .filter((c) => !isOwn(c));
    const wasOpen = (c: { sectionId: string; row: number; seat: number }): boolean => {
      const old = before?.sections.find((s) => s.sectionId === c.sectionId);
      return (
        !!old && ![...old.taken, ...old.reserved].some((p) => p.row === c.row && p.seat === c.seat)
      );
    };
    const late = gone.filter(wasOpen).map(placeKey);
    if (late.length > 0) setLateGone((all) => [...new Set([...all, ...late])]);
  };

  // FR-011, FR-012: what another customer reserved or bought, as it happens. Those seats stay
  // focusable, marked aria-disabled.
  onChange.current = (change: StreamSeatMapChange): void => {
    const gone = change.changes.filter((c) => c.state !== 'open' && !isOwn(c));
    if (gone.length === 0) return;
    setLateGone((all) => [...new Set([...all, ...gone.map(placeKey)])]);
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
        ranOutSeats.current = reservation.seats.map(placeKey);
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

  const seatsLoading =
    event.reservedSeating &&
    live.map === null &&
    (live.status === 'loading' || live.status === 'connecting');
  const seatsFailed = event.reservedSeating && live.map === null && !seatsLoading;
  const leftNow =
    availability.kind === 'ok'
      ? availability.data
      : availability.kind === 'loading'
        ? lastAvailability.current
        : null;
  const tiersNow =
    tiers.kind === 'ok' ? tiers.data : tiers.kind === 'loading' ? lastTiers.current : null;
  if (
    (availability.kind === 'loading' && leftNow === null) ||
    (tiers.kind === 'loading' && tiersNow === null) ||
    seatsLoading
  ) {
    return <p>Loading tickets…</p>;
  }
  // Spec 015 edge case "Event deleted": its stream ended and a reconnect found no event.
  if (event.reservedSeating && live.status === 'missing') {
    return <p className="banner banner--error">This event no longer exists.</p>;
  }
  if (leftNow === null || tiersNow === null || seatsFailed) {
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
  const seated = seatMap?.reservedSeating === true ? seatMap : null;
  // Seats for the chosen tier's sections; every section when the event has no tiers.
  const offered = seated
    ? seated.sections.filter((s) => (tierList.length > 0 ? chosen && s.tierId === chosen.id : true))
    : [];
  const section = offered.find((s) => s.sectionId === sectionId) ?? offered[0] ?? null;
  // Spec 007 FR-006: on a seated event, a tier with no section mapped to it sells nothing.
  const onSale = (t: TicketTier): boolean =>
    !seated || seated.sections.some((s) => s.tierId === t.id);
  const mine: ChosenSeat[] = reservation?.seats ?? [];
  // Spec 015: seats in another customer's reservation (the map never says whose, FR-014).
  const othersReserved = section
    ? section.reserved.filter((p) => {
        const label = { section: section.name, row: p.row, seat: p.seat };
        const place = { sectionId: section.sectionId, row: p.row, seat: p.seat };
        return (
          !mine.some((m) => sameSeat(m, label)) &&
          !releasedHere.includes(seatKey(label)) &&
          !queue.pending.has(placeKey(place))
        );
      })
    : [];
  const late = section
    ? lateGone
        .filter((k) => k.startsWith(`${section.sectionId}-`))
        .map((k) => k.slice(section.sectionId.length + 1))
    : [];
  // Spec 033: the seats held once every queued click is answered.
  const willHold = new Set(mine.map(placeKey));
  for (const [key, action] of queue.pending) {
    if (action === 'hold') willHold.add(key);
    else willHold.delete(key);
  }
  const chosenCount = seated ? willHold.size : Math.min(quantity, maxQuantity);
  const full = chosenCount >= maxQuantity;
  // Spec 033 FR-005 (research R7): while seats are held, or the first is being held, the other
  // ticket types wait until the held seats are released by clicking them.
  const lockedTier = reservation ? reservation.tierId : queue.busy ? tierId : null;
  const heldTier = reservation ? tierList.find((t) => t.id === reservation.tierId) : undefined;
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
    return <OrderConfirmation eventName={event.name} order={phase.order} />;

  const closedBadge =
    left.salesClosed === 'CANCELLED'
      ? 'Cancelled'
      : left.salesClosed === 'STARTED'
        ? 'Sales closed'
        : left.ticketsLeft === 0
          ? 'Sold out'
          : 'Not on sale';
  const closed =
    left.salesClosed === 'CANCELLED'
      ? 'No tickets: this event has been cancelled.'
      : left.salesClosed === 'STARTED'
        ? 'Sales closed: this event has already started.'
        : left.ticketsLeft === 0
          ? 'Sold out: no tickets are left for this event.'
          : seated && tierList.length > 0 && !tierList.some(onSale)
            ? 'No seats are on sale for this event yet.'
            : null;
  // Spec 016 FR-014: after the closed messages, which apply to every customer.
  const reached =
    !closed && limit !== null && limit.remaining === 0
      ? `You have reached the limit of ${tickets(limit.limit)} for this event.`
      : null;

  return (
    <section className="card card--padded get-tickets" aria-labelledby="get-tickets">
      <h2 id="get-tickets">Get tickets</h2>
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
                  disabled={
                    tierLeft(t.id) === 0 ||
                    !onSale(t) ||
                    (lockedTier !== null && t.id !== lockedTier)
                  }
                  onChange={() =>
                    choose(() => {
                      setTierId(t.id);
                      setSectionId(null);
                    })
                  }
                />{' '}
                {!onSale(t)
                  ? `${t.name}, ${usd(t.price)}, no seats on sale`
                  : tierLeft(t.id) === 0
                    ? `${t.name}, ${usd(t.price)}, sold out`
                    : `${t.name}, ${usd(t.price)}, ${count(tierLeft(t.id))} left`}
                {/* Spec 008 US3-2: hidden from the name, which already says it. */}
                {onSale(t) && tierLeft(t.id) === 0 && (
                  <span className="pill pill--danger" aria-hidden="true">
                    Sold out
                  </span>
                )}
              </label>
            ))}
            {/* Spec 033 FR-005: why the other ticket types can't be chosen now. */}
            {heldTier && tierList.length > 1 && (
              <p className="note">{`Your held seats are ${heldTier.name} seats. To choose another ticket type, click your held seats to release them.`}</p>
            )}
          </fieldset>
        ) : (
          <p>{`${usd(event.basePrice)} each, ${count(left.ticketsLeft)} left`}</p>
        )}
        {/* Spec 016 FR-012. */}
        {limit !== null && (
          <p className="note">{`Limit: ${tickets(limit.limit)} per customer. You can get ${limit.remaining} more.`}</p>
        )}
        {seated ? (
          section && seatedForm(section)
        ) : (
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
        )}
      </>
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
   * Spec 033 (FR-001, FR-009, FR-010, FR-016): the section, the seat map (the only control for
   * choosing seats), the hold wait above it, the Your seats box directly below it, and the hold log.
   */
  function seatedForm(here: NonNullable<typeof section>) {
    return (
      <>
        <label>
          Section{' '}
          <select value={here.sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {offered.map((s) => (
              <option key={s.sectionId} value={s.sectionId}>
                {`Section ${s.name}`}
              </option>
            ))}
          </select>
        </label>
        {limit !== null && limitBinds && full && (
          <p className="note">{`No more seats can be chosen: the limit of ${tickets(limit.limit)} per customer allows you ${limit.remaining} more.`}</p>
        )}
        {chosenCount >= RESERVATION_LIMITS.maxSeats && (
          <p className="note">{`A reservation holds at most ${RESERVATION_LIMITS.maxSeats} seats.`}</p>
        )}
        {/* Spec 026 FR-011, spec 033 FR-009: the hold wait, directly above the seats it holds
            back, which stay focusable (aria-disabled) and do nothing until it ends. */}
        {waits.waits.HOLD && <WaitMessage wait={waits.waits.HOLD} />}
        <SeatPicker
          section={here}
          mine={mine}
          pending={queue.pending}
          reserved={othersReserved}
          late={late}
          full={full}
          blocked={waits.waits.HOLD !== undefined}
          onToggle={toggleSeat}
        />
        {reservation && yourSeats(reservation)}
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

  /** Spec 033 FR-010, FR-011 (research R9): the countdown, the seats, the total, Add to cart. */
  function yourSeats(r: Reservation) {
    const each = r.tierId ? tierList.find((t) => t.id === r.tierId)?.price : event.basePrice;
    return (
      <section className="note reservation" aria-labelledby="your-seats-heading">
        <h3 id="your-seats-heading">Your seats</h3>
        <HoldCountdown secondsLeft={secondsLeft ?? r.secondsLeft} warning={warning} />
        <ul aria-label="Held seats">
          {r.seats.map((s) => (
            <li key={placeKey(s)}>{seatLabel(s)}</li>
          ))}
        </ul>
        {each !== undefined && <p>{`Total: ${totalUsd(each, r.seats.length)}`}</p>}
        <button type="button" className="btn btn--primary" onClick={() => navigate('/cart')}>
          Add to cart
        </button>
      </section>
    );
  }
}

const tickets = (n: number): string => `${n} ${n === 1 ? 'ticket' : 'tickets'}`;
