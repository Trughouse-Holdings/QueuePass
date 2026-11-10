import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  holderNameMessage,
  holderNameProblem,
  type Event,
  type Order,
  type Reservation,
  type TicketTier,
} from '@queuepass/shared';
import { useAuth } from '@queuepass/shared/web';
import { HoldCountdown, ONE_MINUTE_LEFT } from '../components/HoldCountdown';
import { OrderConfirmation } from '../components/OrderConfirmation';
import { WaitMessage } from '../components/GetTickets';
import { seatLabel, totalUsd, usd, when } from '../format';
import { useBuy, useWaits, type WaitsApi } from '../use-buy';

/** Spec 033 research R8: how often the cart reads the reservations again while visible. */
const READ_EVERY_MS = 1_000;

/** A reservation in the cart, with its deadline by this browser's monotonic clock. */
interface Entry {
  reservation: Reservation;
  deadline: number;
}

/** What the cart shows of an event, read once per event (research R8). */
type EventDetails = { event: Event; tiers: TicketTier[] };
type EventInfo = EventDetails | 'missing';

/** Review round 2 (S2): an entry whose event could not be read 3 times is shown without it. */
const DETAILS_UNAVAILABLE = 'Details unavailable';

/** One reservation, by its event and when it was made: a later one for the event is another. */
const reservationKey = (r: Reservation): string => `${r.eventId}:${r.createdAt}`;

const ranOutMessage = (name: string): string =>
  `Your reservation for ${name} ran out, so its seats were released. You can hold them again in ` +
  '2 minutes if they are still open.';

/**
 * Spec 033 (FR-012 to FR-015, FR-017; research R1, R8, R9): the cart is the customer's active
 * reservations, as `listMyReservations` returns them, newest first; nothing is stored in the
 * browser. Each event is bought on its own with Buy tickets before its countdown ends, with one
 * Name on tickets field for all of them.
 *
 * The cart opens no seat stream: it reads the reservations again about once a second while the page
 * is visible, at once when it becomes visible or gains focus, and never while hidden; one read at a
 * time, so answers arrive in order. An entry whose purchase is in flight
 * or awaiting Check again is kept until that purchase settles. An entry that vanishes is explained
 * through one `listMyOrders` read: bought, if an order for its event was placed since the cart
 * loaded, otherwise ended. A read answered `401` stops the reads and signs in again.
 */
export function Cart() {
  const { api, signIn } = useAuth();
  const waits = useWaits();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [infos, setInfos] = useState<Record<string, EventInfo>>({});
  const [confirmed, setConfirmed] = useState<{ eventName: string; order: Order }[]>([]);
  // A reservation that ran out, or a refusal saying so: an alert (FR-015).
  const [alert, setAlert] = useState<string | null>(null);
  // Why an entry left the cart, when it left by itself (FR-017): polite.
  const [status, setStatus] = useState<ReactNode>(null);
  // Spec 017 FR-001: the buyer's name, on every ticket bought here.
  const [holderName, setHolderName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);

  const entriesRef = useRef<Entry[] | null>(null);
  entriesRef.current = entries;
  const infosRef = useRef(infos);
  infosRef.current = infos;
  // Entries whose purchase is in flight or awaiting Check again, by event.
  const busy = useRef(new Set<string>());
  // Reservations that ran out or were bought here: a read that still lists one is behind.
  const finished = useRef(new Set<string>());
  const reading = useRef(false);
  const stopped = useRef(false);
  const requested = useRef(new Set<string>());
  // Review round 2 (S2): an event's failed reads, and when it may be read again (1, 2, 4 … 10 s).
  const [failures, setFailures] = useState<Record<string, number>>({});
  const failuresRef = useRef<Record<string, number>>({});
  const retryAt = useRef(new Map<string, number>());

  const nameOf = (eventId: string): string => {
    const info = infosRef.current[eventId];
    return info && info !== 'missing' ? info.event.name : 'this event';
  };

  /** Drops an entry from the cart, and remembers its reservation as finished. */
  const drop = useCallback((r: Reservation): void => {
    finished.current.add(reservationKey(r));
    busy.current.delete(r.eventId);
    setEntries((all) => (all ?? []).filter((e) => e.reservation.eventId !== r.eventId));
  }, []);

  /** FR-015: the countdown reached 0, or a purchase was refused as run out. */
  const ranOut = useCallback(
    (r: Reservation): void => {
      drop(r);
      setAlert(ranOutMessage(nameOf(r.eventId)));
    },
    [drop],
  );

  /**
   * FR-017: one `listMyOrders` read says whether a vanished entry was bought here or elsewhere: an
   * order for its event placed since the reservation was made, both times the Backend's (review
   * round 1, N5), holding one of its seats (round 2, N3).
   */
  const explain = useCallback(
    async (r: Reservation): Promise<void> => {
      const name = nameOf(r.eventId);
      let bought = false;
      try {
        const { data } = await api.GET('/me/orders');
        bought = (data ?? []).some(
          (o) =>
            o.eventId === r.eventId &&
            Date.parse(o.createdAt) >= Date.parse(r.createdAt) &&
            // One of the reservation's own seats: a general-admission order, or other seats,
            // bought in another tab is not this reservation's (review round 2, N3).
            o.tickets.some(
              (t) =>
                t.seat !== null &&
                r.seats.some(
                  (s) =>
                    s.section === t.seat?.section && s.row === t.seat.row && s.seat === t.seat.seat,
                ),
            ),
        );
      } catch {
        // Not known: said as ended.
      }
      setStatus(
        bought ? (
          <p>
            {`Your seats for ${name} were bought. See them in `}
            <Link to="/my-tickets">My tickets</Link>.
          </p>
        ) : (
          <p>{`Your reservation for ${name} ended.`}</p>
        ),
      );
    },
    [api],
  );

  /** Research R8: the latest reservations, merged with what the cart shows. */
  const apply = useCallback(
    (list: Reservation[]): void => {
      const now = performance.now();
      const before = entriesRef.current ?? [];
      const listed = list.filter((r) => !finished.current.has(reservationKey(r)));
      const next: Entry[] = listed.map((r) => {
        const known = before.find((e) => reservationKey(e.reservation) === reservationKey(r));
        // An entry's end never moves: its deadline is kept from when it first appeared.
        return { reservation: r, deadline: known?.deadline ?? now + r.secondsLeft * 1000 };
      });
      for (const e of before) {
        if (next.some((n) => n.reservation.eventId === e.reservation.eventId)) continue;
        if (busy.current.has(e.reservation.eventId)) {
          // A purchase in progress: its own answer decides what the entry shows.
          next.push(e);
        } else if (e.deadline - now <= 2_000) {
          // Gone within 2 seconds of its end: the run-out the countdown is about to show. (Bought
          // in another tab in those last 2 seconds is told as run out here; My tickets has it.)
          ranOut(e.reservation);
        } else {
          finished.current.add(reservationKey(e.reservation));
          void explain(e.reservation);
        }
      }
      next.sort(
        (a, b) => Date.parse(b.reservation.createdAt) - Date.parse(a.reservation.createdAt),
      );
      entriesRef.current = next;
      setEntries(next);
    },
    [ranOut, explain],
  );

  const read = useCallback(async (): Promise<void> => {
    if (reading.current || stopped.current) return;
    reading.current = true;
    try {
      const { data, response } = await api.GET('/me/reservations');
      if (response.status === 401) {
        stopped.current = true;
        await signIn();
        return;
      }
      if (!response.ok || !data) return;
      apply(data);
    } catch {
      // The next read tries again.
    } finally {
      reading.current = false;
    }
  }, [api, signIn, apply]);

  // FR-017: about once a second while visible; at once on becoming visible or gaining focus.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = (): void => {
      if (timer === undefined) timer = setInterval(() => void read(), READ_EVERY_MS);
    };
    const stop = (): void => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        void read();
        start();
      } else stop();
    };
    const onFocus = (): void => void read();
    void read();
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [read]);

  // Research R8: each listed event's details and ticket types, read once while the page is open.
  useEffect(() => {
    /** A failed read: tried again after 1, 2, 4, … seconds, at most 10, with the reads. */
    const failed = (eventId: string): void => {
      requested.current.delete(eventId);
      const n = (failuresRef.current[eventId] ?? 0) + 1;
      failuresRef.current = { ...failuresRef.current, [eventId]: n };
      retryAt.current.set(eventId, performance.now() + Math.min(1_000 * 2 ** (n - 1), 10_000));
      setFailures(failuresRef.current);
    };
    for (const e of entries ?? []) {
      const eventId = e.reservation.eventId;
      if (requested.current.has(eventId) || infos[eventId] !== undefined) continue;
      if (performance.now() < (retryAt.current.get(eventId) ?? 0)) continue;
      requested.current.add(eventId);
      void (async () => {
        try {
          const [ev, tiers] = await Promise.all([
            api.GET('/events/{id}', { params: { path: { id: eventId } } }),
            api.GET('/events/{id}/tiers', { params: { path: { id: eventId } } }),
          ]);
          if (ev.response.status === 401) return void signIn();
          let info: EventInfo;
          if (ev.response.status === 404) {
            // Deleted since: its reservation went with it, so it is not listed.
            info = 'missing';
          } else if (ev.response.ok && ev.data && tiers.response.ok && tiers.data) {
            info = { event: ev.data, tiers: tiers.data };
          } else {
            // Any other failure: read again later (review round 1, S2), never taken for a
            // deleted event.
            failed(eventId);
            return;
          }
          setInfos((all) => ({ ...all, [eventId]: info }));
        } catch {
          // No answer: read again later.
          failed(eventId);
        }
      })();
    }
  }, [entries, infos, api, signIn]);

  // Until every listed event's details are known, or failed 3 times, the cart is loading, not
  // empty (review rounds 1 and 2, S2). After 3 failures the entry shows without them.
  const unavailable = (eventId: string): boolean =>
    infos[eventId] === undefined && (failures[eventId] ?? 0) >= 3;
  const pending = (entries ?? []).some(
    (e) => infos[e.reservation.eventId] === undefined && !unavailable(e.reservation.eventId),
  );
  const shown = (entries ?? []).flatMap((e) => {
    const info = infos[e.reservation.eventId];
    if (info && info !== 'missing') return [{ entry: e, info: info as EventDetails | null }];
    return unavailable(e.reservation.eventId) ? [{ entry: e, info: null }] : [];
  });
  const nameProblem = holderNameProblem(holderName);
  const nameError = nameTouched && nameProblem !== null ? holderNameMessage(nameProblem) : null;

  return (
    <section>
      <h1 className="page-title">Cart</h1>
      {/* Spec 026 FR-013: the one live region for refusals for the limit (review M2, M3). */}
      <p
        className="visually-hidden"
        aria-live="assertive"
        aria-atomic="true"
        data-announces="rate-limit"
      >
        {waits.announcement}
      </p>
      {alert && (
        <p role="alert" className="banner banner--error">
          {alert}
        </p>
      )}
      <div role="status" className={status ? 'note' : undefined}>
        {status}
      </div>
      {confirmed.map((c) => (
        <OrderConfirmation key={c.order.id} eventName={c.eventName} order={c.order} />
      ))}
      {entries === null || (pending && shown.length === 0) ? (
        <p>Loading your cart…</p>
      ) : shown.length === 0 ? (
        <p>Your cart is empty. Seats you hold on an event&apos;s page appear here for 5 minutes.</p>
      ) : (
        <>
          {/* Spec 017 FR-001, spec 033 FR-013: one name, on every ticket bought here. */}
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
              onChange={(e) => setHolderName(e.target.value)}
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
          {shown.map(({ entry, info }) => (
            <CartEntry
              key={reservationKey(entry.reservation)}
              entry={entry}
              event={info?.event ?? null}
              tiers={info?.tiers ?? []}
              holderName={holderName}
              nameOk={nameProblem === null}
              waits={waits}
              onBusy={(on) =>
                on
                  ? busy.current.add(entry.reservation.eventId)
                  : busy.current.delete(entry.reservation.eventId)
              }
              onBought={(order) => {
                drop(entry.reservation);
                setConfirmed((all) => [
                  ...all,
                  // Review round 3 (N5): without its details, the event is "this event".
                  { eventName: info?.event.name ?? 'this event', order },
                ]);
              }}
              onRanOut={() => ranOut(entry.reservation)}
              onEnded={() => {
                drop(entry.reservation);
                setStatus(
                  <p>{`Your reservation for ${nameOf(entry.reservation.eventId)} ended.`}</p>,
                );
              }}
            />
          ))}
        </>
      )}
    </section>
  );
}

/**
 * Spec 033 FR-013, FR-014, FR-015: one event in the cart: its name, date and time in the venue's
 * zone, ticket type and price, countdown, seats, total, Change seats, and Buy tickets, which buys
 * exactly this reservation's seats as Confirm purchase did (`use-buy.ts`).
 */
function CartEntry({
  entry,
  event,
  tiers,
  holderName,
  nameOk,
  waits,
  onBusy,
  onBought,
  onRanOut,
  onEnded,
}: {
  entry: Entry;
  /** `null`: its details could not be read (review round 2, S2); it can still be bought. */
  event: Event | null;
  tiers: TicketTier[];
  holderName: string;
  nameOk: boolean;
  waits: WaitsApi;
  onBusy(on: boolean): void;
  onBought(order: Order): void;
  onRanOut(): void;
  onEnded(): void;
}) {
  const r = entry.reservation;
  const buyer = useBuy(r.eventId, waits);
  const [notice, setNotice] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((entry.deadline - performance.now()) / 1000)),
  );
  const [warning, setWarning] = useState<string | null>(null);
  const buyButton = useRef<HTMLButtonElement>(null);
  const checkAgainButton = useRef<HTMLButtonElement>(null);
  const settled = useRef(false);
  const phase = buyer.phase;
  const inProgress = phase.kind === 'confirming' || phase.kind === 'unknown';
  const inProgressRef = useRef(inProgress);
  inProgressRef.current = inProgress;
  const ranOutRef = useRef(onRanOut);
  ranOutRef.current = onRanOut;

  // FR-015: the countdown from this entry's own secondsLeft, the 1-minute warning once, and 0.
  useEffect(() => {
    const tick = (): void => {
      const left = Math.max(0, Math.ceil((entry.deadline - performance.now()) / 1000));
      setSecondsLeft(left);
      // Once per reservation on this page; a cart opened with under a minute left says it on
      // opening, as the event page does (review round 1, N4).
      if (left > 0 && left <= 60) setWarning(ONE_MINUTE_LEFT);
      if (left === 0 && !inProgressRef.current && !settled.current) {
        settled.current = true;
        ranOutRef.current();
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [entry.deadline]);

  const tier = r.tierId ? tiers.find((t) => t.id === r.tierId) : undefined;
  // Without its event's details the price is not known; the order does not need it.
  const price = !event ? undefined : r.tierId ? tier?.price : event.basePrice;
  const headingId = `cart-${r.eventId}`;

  async function buy(): Promise<void> {
    if (!nameOk && phase.kind !== 'unknown') return;
    // Spec 026 FR-013: waiting out the limit, the buying buttons do nothing.
    if (waits.waits.BUY) return;
    onBusy(true);
    setNotice(null);
    const pressed = phase.kind === 'unknown' ? checkAgainButton : buyButton;
    const outcome = await buyer.buy(
      {
        ...(r.tierId ? { tierId: r.tierId } : {}),
        holderName,
        quantity: r.seats.length,
        seats: r.seats.map((s) => ({ sectionId: s.sectionId, row: s.row, seat: s.seat })),
      },
      pressed,
    );
    // Still in progress: Check again settles it, or the purchase already in flight does.
    if (outcome.kind === 'unknown' || outcome.kind === 'busy') return;
    onBusy(false);
    if (outcome.kind === 'done') {
      settled.current = true;
      onBought(outcome.order);
    } else if (outcome.kind === 'refused') {
      const e = outcome.error?.error;
      if (e?.code === 'RESERVATION_REQUIRED') {
        // FR-014, US3-3: nothing was bought; the reservation is gone.
        settled.current = true;
        if (e.details?.expired === true) onRanOut();
        else onEnded();
      } else {
        setNotice(e?.message ?? 'The purchase was refused.');
      }
    }
  }

  return (
    <section className="card card--padded" aria-labelledby={headingId}>
      <h2 id={headingId}>
        <Link to={`/events/${r.eventId}`}>{event?.name ?? DETAILS_UNAVAILABLE}</Link>
      </h2>
      <HoldCountdown secondsLeft={secondsLeft} warning={warning} />
      {event && <p>{when(event.startsAt, event.location.timeZone)}</p>}
      {price !== undefined && (
        <p>{tier ? `${tier.name}, ${usd(price)} each` : `${usd(price)} each`}</p>
      )}
      <ul aria-label="Seats">
        {r.seats.map((s) => (
          <li key={`${s.sectionId}-${s.row}-${s.seat}`}>{seatLabel(s)}</li>
        ))}
      </ul>
      {price !== undefined && <p>{`Total: ${totalUsd(price, r.seats.length)}`}</p>}
      {notice && (
        <p role="alert" className="banner banner--error">
          {notice}
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
              onClick={() => void buy()}
            >
              Check again
            </button>
          </div>
        </div>
      ) : (
        <div className="form__actions">
          <Link to={`/events/${r.eventId}`}>Change seats</Link>
          {waits.waits.BUY && <WaitMessage wait={waits.waits.BUY} />}
          <button
            ref={buyButton}
            type="button"
            className="btn btn--primary"
            disabled={!nameOk || phase.kind !== 'choosing'}
            aria-disabled={waits.waits.BUY ? true : undefined}
            onClick={() => void buy()}
          >
            {phase.kind === 'confirming' ? 'Buying…' : 'Buy tickets'}
          </button>
        </div>
      )}
    </section>
  );
}
