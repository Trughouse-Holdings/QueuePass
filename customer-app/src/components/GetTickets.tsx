import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ORDER_LIMITS,
  type Availability,
  type Event,
  type Order,
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

/**
 * Spec 006 US1 and US2: choose a tier (or the base price), a quantity, see the exact total, and
 * confirm; or learn why tickets can't be had. Spec 007: for an event with reserved seating, choose
 * a tier, a section, and seats instead of a quantity. The Backend decides every rule (FR-003);
 * the counts and taken seats shown here are guidance.
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
  // Spec 007: the chosen section (null: the first offered) and the seats chosen so far.
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [seats, setSeats] = useState<ChosenSeat[]>([]);
  // FR-005: one id per confirmation, created on the first press and kept for that confirmation.
  const requestId = useRef<string | null>(null);
  // Set synchronously, so a second click before React re-renders sends nothing.
  const sending = useRef(false);

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
  const maxQuantity = Math.max(1, Math.min(ORDER_LIMITS.maxQuantity, ticketsLeft));
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
  const chosenCount = seated ? seats.length : Math.min(quantity, maxQuantity);
  const canConfirm =
    price !== undefined && ticketsLeft > 0 && chosenCount > 0 && phase.kind === 'choosing';

  const choose = (change: () => void): void => {
    change();
    requestId.current = null;
  };
  const toggleSeat = (seat: ChosenSeat): void =>
    choose(() =>
      setSeats((all) =>
        all.some(
          (c) => c.sectionId === seat.sectionId && c.row === seat.row && c.seat === seat.seat,
        )
          ? all.filter(
              (c) =>
                !(c.sectionId === seat.sectionId && c.row === seat.row && c.seat === seat.seat),
            )
          : [...all, seat],
      ),
    );

  async function confirm(): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    requestId.current ??= crypto.randomUUID();
    setPhase({ kind: 'confirming' });
    try {
      const { data, error, response } = await api.POST('/events/{id}/orders', {
        params: { path: { id } },
        body: {
          ...(chosen ? { tierId: chosen.id } : {}),
          quantity: chosenCount,
          requestId: requestId.current,
          ...(seated
            ? { seats: seats.map((c) => ({ sectionId: c.sectionId, row: c.row, seat: c.seat })) }
            : {}),
        },
      });
      if (response.ok && data) {
        setNotice(null);
        setPhase({ kind: 'done', order: data as Order });
      } else if (response.status === 401) {
        // The token is checked before any ordering rule, so nothing was recorded.
        setPhase({ kind: 'choosing' });
        await signIn();
      } else if (response.status >= 500) {
        setPhase({ kind: 'unknown' });
      } else {
        // Refused: nothing was recorded. The next press is a new confirmation.
        setNotice(error?.error.message ?? 'The order was refused.');
        if (error?.error.code === 'SEAT_TAKEN') {
          // Spec 007 US3-2: let go of the taken seats, keep the rest.
          const gone = (error.error.details?.seats ?? []) as SeatLabel[];
          setSeats((all) =>
            all.filter(
              (c) =>
                !gone.some((g) => g.section === c.section && g.row === c.row && g.seat === c.seat),
            ),
          );
        }
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
                full={seats.length >= maxQuantity}
                onToggle={toggleSeat}
              />
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
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canConfirm}
          onClick={() => void confirm()}
        >
          {phase.kind === 'confirming' ? 'Confirming…' : 'Confirm order'}
        </button>
      </>
    );
  }
}

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
