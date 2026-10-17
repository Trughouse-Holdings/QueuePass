import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ORDER_LIMITS,
  type Availability,
  type ErrorEnvelope,
  type Event,
  type Order,
  type Reservation,
  type SeatLabel,
  type SeatMap,
  type TicketTier,
} from '@queuepass/shared';
import { useAuth } from '@queuepass/shared/web';
import { cents, count, seatLabel, totalUsd, usd } from '../format';
import { useLoad } from '../use-load';
import { SeatPicker, type ChosenSeat } from './SeatPicker';

type Phase =
  | { kind: 'choosing' }
  | { kind: 'confirming' }
  | { kind: 'done'; order: Order }
  // No answer, or a server error: the order may or may not exist (spec 006 edge cases).
  | { kind: 'unknown' };

const sameSeat = (a: SeatLabel, b: SeatLabel): boolean =>
  a.section === b.section && a.row === b.row && a.seat === b.seat;
const seatKey = (s: SeatLabel): string => `${s.section}-${s.row}-${s.seat}`;

/** Spec 015 FR-005: the countdown as `m:ss`. */
const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Spec 006 US1 and US2: choose a tier (or the base price), a quantity, see the exact total, and
 * confirm; or learn why tickets can't be had. Spec 007: for an event with reserved seating, choose
 * a tier, a section, and seats instead of a quantity. Spec 015 (research R13): picked seats are
 * reserved for 5 minutes with Reserve seats, then bought with Confirm purchase. The Backend decides
 * every rule (FR-003); the counts, taken seats, and countdown shown here are guidance.
 */
export function GetTickets({ event }: { event: Event }) {
  const { api, signIn } = useAuth();
  const id = event.id;
  // Bumped after a refusal, so what is left is loaded again.
  const [reloads, setReloads] = useState(0);
  const availability = useLoad<Availability>(`availability:${id}:${reloads}`, (a) =>
    a.GET('/events/{id}/availability', { params: { path: { id } } }),
  );
  const tiers = useLoad<TicketTier[]>(`tiers:${id}`, (a) =>
    a.GET('/events/{id}/tiers', { params: { path: { id } } }),
  );
  // Spec 007: only a seated event needs its seat map; for the rest, settle at once with nothing.
  const seatMap = useLoad<SeatMap | undefined>(
    `seats:${id}:${event.reservedSeating}:${reloads}`,
    (a) =>
      event.reservedSeating
        ? a.GET('/events/{id}/seats', { params: { path: { id } } })
        : Promise.resolve({ data: undefined, response: new Response(null, { status: 204 }) }),
  );

  const [tierId, setTierId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [phase, setPhase] = useState<Phase>({ kind: 'choosing' });
  // FR-006: the Backend's reason for the last refusal, in its own words.
  const [notice, setNotice] = useState<string | null>(null);
  // Spec 007: the chosen section (null: the first offered) and the seats picked so far.
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [seats, setSeats] = useState<ChosenSeat[]>([]);
  // Spec 015: the customer's active reservation for this event, and the countdown to its end.
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [ranOut, setRanOut] = useState(false);
  // FR-012: what the status region says (the 1-minute warning), separate from the timer.
  const [status, setStatus] = useState<string | null>(null);
  // Research R13: the deadline by this browser's monotonic clock, from the Backend's secondsLeft.
  const deadline = useRef<number | null>(null);
  const warned = useRef(false);
  // Seats this customer released since the map loaded: open, though the map still says reserved.
  const [releasedHere, setReleasedHere] = useState<string[]>([]);
  // FR-005: one id per confirmation, created on the first press and kept for that confirmation.
  const requestId = useRef<string | null>(null);
  // Set synchronously, so a second click before React re-renders sends nothing.
  const sending = useRef(false);

  /** Shows a reservation; the countdown starts only for a new one, never restarts (FR-004). */
  const adopt = useCallback((r: Reservation | null) => {
    setReservation(r);
    if (!r) {
      deadline.current = null;
      setSecondsLeft(null);
      return;
    }
    if (deadline.current === null) {
      deadline.current = performance.now() + r.secondsLeft * 1000;
      warned.current = false;
      setSecondsLeft(r.secondsLeft);
    }
    if (r.tierId) setTierId(r.tierId);
    setRanOut(false);
  }, []);

  /** Research R8: a reservation made earlier, in this tab or another, is shown on load. */
  const loadMine = useCallback(async () => {
    try {
      const { data } = await api.GET('/me/reservations');
      adopt(data?.find((r) => r.eventId === id) ?? null);
    } catch {
      // Unknown for now; the Backend still decides every order.
    }
  }, [api, id, adopt]);

  useEffect(() => {
    if (event.reservedSeating) void loadMine();
  }, [event.reservedSeating, loadMine]);

  useEffect(() => setReleasedHere([]), [seatMap]);

  // FR-005, FR-012: the countdown, a single 1-minute warning, and the end of the 5 minutes.
  useEffect(() => {
    if (!reservation) return;
    const tick = (): void => {
      if (deadline.current === null) return;
      const left = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
      setSecondsLeft(left);
      if (left > 0 && left <= 60 && !warned.current) {
        warned.current = true;
        setStatus('1 minute left to confirm your purchase.');
      }
      if (left === 0) {
        // The picks are kept, so the customer can reserve them again (US1-4).
        setSeats((all) => [
          ...all,
          ...reservation.seats.filter((r) => !all.some((c) => sameSeat(c, r))),
        ]);
        deadline.current = null;
        setReservation(null);
        setSecondsLeft(null);
        setNotice(null);
        setStatus(null);
        setRanOut(true);
        requestId.current = null;
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [reservation]);

  if (availability.kind === 'loading' || tiers.kind === 'loading' || seatMap.kind === 'loading') {
    return <p>Loading tickets…</p>;
  }
  if (availability.kind !== 'ok' || tiers.kind !== 'ok' || seatMap.kind !== 'ok') {
    // Spec 012 FR-010: an error, so the theme's error banner; no role added, as before.
    return (
      <p className="banner banner--error">
        Ticket information is unavailable right now. Try again later.
      </p>
    );
  }

  const left = availability.data;
  const tierList = tiers.data;
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
  const seated = seatMap.data?.reservedSeating === true ? seatMap.data : null;
  // Seats for the chosen tier's sections; every section when the event has no tiers.
  const offered = seated
    ? seated.sections.filter((s) => (tierList.length > 0 ? chosen && s.tierId === chosen.id : true))
    : [];
  const section = offered.find((s) => s.sectionId === sectionId) ?? offered[0] ?? null;
  // Spec 007 FR-006: on a seated event, a tier with no section mapped to it sells nothing.
  const onSale = (t: TicketTier): boolean =>
    !seated || seated.sections.some((s) => s.tierId === t.id);
  const mine = reservation?.seats ?? [];
  // Spec 015: seats in another customer's reservation (the map never says whose, FR-014).
  const othersReserved = section
    ? (section.reserved ?? []).filter((p) => {
        const label = { section: section.name, row: p.row, seat: p.seat };
        return !mine.some((m) => sameSeat(m, label)) && !releasedHere.includes(seatKey(label));
      })
    : [];
  const chosenCount = seated ? seats.length + mine.length : Math.min(quantity, maxQuantity);
  const canConfirm =
    price !== undefined && ticketsLeft > 0 && chosenCount > 0 && phase.kind === 'choosing';
  const canReserve = price !== undefined && seats.length > 0 && phase.kind === 'choosing';

  const choose = (change: () => void): void => {
    change();
    requestId.current = null;
  };
  const toggleSeat = (seat: ChosenSeat): void => {
    // Research R13: deselecting a reserved seat releases it at once (FR-007).
    if (mine.some((m) => sameSeat(m, seat))) {
      void release([seat]);
      return;
    }
    choose(() =>
      setSeats((all) =>
        all.some((c) => sameSeat(c, seat)) ? all.filter((c) => !sameSeat(c, seat)) : [...all, seat],
      ),
    );
  };

  /** Explains a refusal, keeping every pick that is still open (Constitution IV, FR-002). */
  function refused(error: ErrorEnvelope | undefined): void {
    const e = error?.error;
    setRanOut(false);
    if (e?.code === 'SEAT_TAKEN') {
      // Spec 007 US3-2, spec 015 US1-2: let go of the taken seats, keep the rest.
      const gone = (e.details?.seats ?? []) as SeatLabel[];
      setSeats((all) => all.filter((c) => !gone.some((g) => sameSeat(g, c))));
      setNotice(e.message);
      setReloads((n) => n + 1);
    } else if (e?.code === 'SEAT_COOLDOWN') {
      // FR-004a: when, in the customer's own time zone.
      const waiting = (e.details?.seats ?? []) as SeatLabel[];
      const at = new Date(String(e.details?.availableAt)).toLocaleTimeString('en-US', {
        timeStyle: 'short',
      });
      setNotice(
        `You released ${waiting.map(seatLabel).join('; ')} less than 2 minutes ago. You can ` +
          `reserve ${waiting.length === 1 ? 'it' : 'them'} again at ${at}.`,
      );
    } else if (e?.code === 'RESERVATION_REQUIRED') {
      // FR-006: the reservation is gone (ran out, or ended by an admin change); keep its seats as
      // picks and look again for what the Backend has.
      setSeats((all) => [...all, ...mine.filter((r) => !all.some((c) => sameSeat(c, r)))]);
      adopt(null);
      setNotice(e.message);
      void loadMine();
    } else {
      setNotice(e?.message ?? 'The request was refused.');
    }
  }

  async function reserve(): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    try {
      const { data, error, response } = await api.POST('/events/{id}/reservation', {
        params: { path: { id } },
        body: { seats: seats.map((c) => ({ sectionId: c.sectionId, row: c.row, seat: c.seat })) },
      });
      if (response.ok && data) {
        setNotice(null);
        setSeats([]);
        adopt(data);
      } else if (response.status === 401) {
        await signIn();
      } else {
        refused(error);
      }
    } catch {
      setNotice("Can't reach QueuePass right now. Your seats weren't reserved; try again.");
    } finally {
      sending.current = false;
    }
  }

  /** FR-007: releases the listed seats, or all of them. The countdown doesn't change. */
  async function release(which?: ChosenSeat[]): Promise<void> {
    try {
      const { data, response } = await api.POST('/events/{id}/reservation/release', {
        params: { path: { id } },
        ...(which
          ? {
              body: {
                seats: which.map((c) => ({ sectionId: c.sectionId, row: c.row, seat: c.seat })),
              },
            }
          : {}),
      });
      if (response.status === 401) {
        await signIn();
        return;
      }
      if (!response.ok) {
        void loadMine();
        return;
      }
      const freed = which ?? mine;
      setReleasedHere((all) => [...all, ...freed.map(seatKey)]);
      adopt(data?.reservation ?? null);
      setStatus(null);
    } catch {
      void loadMine();
    }
  }

  async function confirm(): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    requestId.current ??= crypto.randomUUID();
    setPhase({ kind: 'confirming' });
    // Spec 015 FR-006: a seated order buys the reserved seats.
    const buying = seated ? mine : [];
    try {
      const { data, error, response } = await api.POST('/events/{id}/orders', {
        params: { path: { id } },
        body: {
          ...(chosen ? { tierId: chosen.id } : {}),
          quantity: seated ? buying.length : chosenCount,
          requestId: requestId.current,
          ...(seated
            ? { seats: buying.map((c) => ({ sectionId: c.sectionId, row: c.row, seat: c.seat })) }
            : {}),
        },
      });
      if (response.ok && data) {
        setNotice(null);
        adopt(null);
        setPhase({ kind: 'done', order: data as Order });
      } else if (response.status === 401) {
        // The token is checked before any ordering rule, so nothing was recorded.
        setPhase({ kind: 'choosing' });
        await signIn();
      } else if (response.status >= 500) {
        setPhase({ kind: 'unknown' });
      } else {
        // Refused: nothing was recorded. The next press is a new confirmation.
        refused(error);
        requestId.current = null;
        setReloads((n) => n + 1);
        setPhase({ kind: 'choosing' });
      }
    } catch {
      setPhase({ kind: 'unknown' });
    } finally {
      sending.current = false;
    }
  }

  if (phase.kind === 'done') return <Confirmation event={event} order={phase.order} />;

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
      {/* Spec 015 FR-005, FR-012: the end of the 5 minutes is announced as an alert. */}
      {ranOut && (
        <p role="alert" className="banner banner--error">
          Your reservation ran out, so its seats were released. You can reserve them again in 2
          minutes if they are still open.
        </p>
      )}
      {phase.kind === 'unknown' ? (
        <div role="alert" className="banner banner--conflict">
          <div className="banner__body">
            <p>We couldn&apos;t confirm whether your order went through.</p>
            <p>
              Check again, which never places a second order, or look for it in{' '}
              <Link to="/my-tickets">My tickets</Link>.
            </p>
            <button type="button" className="btn btn--ghost" onClick={() => void confirm()}>
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
                  disabled={tierLeft(t.id) === 0 || !onSale(t)}
                  onChange={() =>
                    choose(() => {
                      // Spec 015 research R13: another tier releases the active reservation first.
                      if (reservation && reservation.tierId !== t.id) void release();
                      setTierId(t.id);
                      // One tier per order (spec 007): seats of another tier don't carry over.
                      setSeats([]);
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
          </fieldset>
        ) : (
          <p>{`${usd(event.basePrice)} each, ${count(left.ticketsLeft)} left`}</p>
        )}
        {/* Spec 016 FR-012. */}
        {limit !== null && (
          <p className="note">{`Limit: ${tickets(limit.limit)} per customer. You can get ${limit.remaining} more.`}</p>
        )}
        {seated ? (
          section && (
            <>
              <label>
                Section{' '}
                <select value={section.sectionId} onChange={(e) => setSectionId(e.target.value)}>
                  {offered.map((s) => (
                    <option key={s.sectionId} value={s.sectionId}>
                      {`Section ${s.name}`}
                    </option>
                  ))}
                </select>
              </label>
              <SeatPicker
                section={section}
                chosen={seats}
                mine={mine}
                reserved={othersReserved}
                full={chosenCount >= maxQuantity}
                onToggle={toggleSeat}
              />
              {limit !== null && limitBinds && chosenCount >= maxQuantity && (
                <p className="note">{`No more seats can be chosen: the limit of ${tickets(limit.limit)} per customer allows you ${limit.remaining} more.`}</p>
              )}
              <ul aria-label="Chosen seats">
                {seats.map((c) => (
                  <li key={`${c.sectionId}-${c.row}-${c.seat}`}>
                    <span>{seatLabel(c)}</span>{' '}
                    <button
                      type="button"
                      aria-label={`Remove ${seatLabel(c)}`}
                      onClick={() => toggleSeat(c)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={reservation ? 'btn' : 'btn btn--primary'}
                disabled={!canReserve}
                onClick={() => void reserve()}
              >
                Reserve seats
              </button>
              {reservation && reserved(reservation)}
              {/* FR-012: announced, unlike the timer; FR-011 messages join it (US3). */}
              <p role="status" className="note">
                {status}
              </p>
            </>
          )
        ) : (
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
        )}
        {price !== undefined && <p>{`Total: ${totalUsd(price, chosenCount)}`}</p>}
        {!seated && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canConfirm}
            onClick={() => void confirm()}
          >
            {phase.kind === 'confirming' ? 'Confirming…' : 'Confirm order'}
          </button>
        )}
      </>
    );
  }

  /** Spec 015 FR-005: the reserved seats, the countdown, Confirm purchase, and Release seats. */
  function reserved(r: Reservation) {
    return (
      <section className="note reservation" aria-labelledby="reserved-heading">
        <h3 id="reserved-heading">Reserved for you</h3>
        {/* A timer isn't announced (aria-live off); the 1-minute warning is, below. */}
        <p role="timer" aria-live="off">
          {`Time left to confirm: ${clock(secondsLeft ?? r.secondsLeft)}`}
        </p>
        <ul aria-label="Reserved seats">
          {r.seats.map((s) => (
            <li key={`${s.sectionId}-${s.row}-${s.seat}`}>
              <span>{seatLabel(s)}</span>{' '}
              <button
                type="button"
                aria-label={`Release ${seatLabel(s)}`}
                onClick={() => void release([s])}
              >
                Release
              </button>
            </li>
          ))}
        </ul>
        <div className="form__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canConfirm}
            onClick={() => void confirm()}
          >
            {phase.kind === 'confirming' ? 'Confirming…' : 'Confirm purchase'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void release()}>
            Release seats
          </button>
        </div>
      </section>
    );
  }
}

const tickets = (n: number): string => `${n} ${n === 1 ? 'ticket' : 'tickets'}`;

/** Spec 006 FR-004: what was bought, what it cost, and every ticket code. */
function Confirmation({ event, order }: { event: Event; order: Order }) {
  return (
    <section aria-label="Order confirmed">
      <h2>Order confirmed</h2>
      <dl>
        <dt>Event</dt>
        <dd>{event.name}</dd>
        {order.tierName && (
          <>
            <dt>Tier</dt>
            <dd>{order.tierName}</dd>
          </>
        )}
        <dt>Quantity</dt>
        <dd>{order.quantity}</dd>
        <dt>Price each</dt>
        <dd>{usd(order.unitPrice)}</dd>
        <dt>Total charged</dt>
        <dd>{usd(order.totalPrice)}</dd>
      </dl>
      <h3>Your ticket codes</h3>
      <ul aria-label="Ticket codes">
        {order.tickets.map((t) => (
          <li key={t.id}>{t.seat ? `${t.code}, ${seatLabel(t.seat)}` : t.code}</li>
        ))}
      </ul>
      <Link to="/my-tickets">See all my tickets</Link>
    </section>
  );
}
