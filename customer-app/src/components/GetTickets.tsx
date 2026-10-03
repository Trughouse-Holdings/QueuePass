import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ORDER_LIMITS,
  type Availability,
  type Event,
  type Order,
  type TicketTier,
} from '@queuepass/shared';
import { useAuth } from '@queuepass/shared/web';
import { count, totalUsd, usd } from '../format';
import { useLoad } from '../use-load';

type Phase = { kind: 'choosing' } | { kind: 'confirming' } | { kind: 'done'; order: Order };

/**
 * Spec 006 US1: choose a tier (or the base price), a quantity, see the exact total, and confirm.
 * The Backend decides every rule (FR-003); the counts shown here are guidance.
 */
export function GetTickets({ event }: { event: Event }) {
  const { api } = useAuth();
  const id = event.id;
  const availability = useLoad<Availability>(`availability:${id}`, (a) =>
    a.GET('/events/{id}/availability', { params: { path: { id } } }),
  );
  const tiers = useLoad<TicketTier[]>(`tiers:${id}`, (a) =>
    a.GET('/events/{id}/tiers', { params: { path: { id } } }),
  );

  const [tierId, setTierId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [phase, setPhase] = useState<Phase>({ kind: 'choosing' });
  // FR-005: one id per confirmation, created on the first press and kept for that confirmation.
  const requestId = useRef<string | null>(null);
  // Set synchronously, so a second click before React re-renders sends nothing.
  const sending = useRef(false);

  if (availability.kind === 'loading' || tiers.kind === 'loading') return <p>Loading tickets…</p>;
  if (availability.kind !== 'ok' || tiers.kind !== 'ok') {
    return <p>Ticket information is unavailable right now. Try again later.</p>;
  }

  const left = availability.data;
  const tierList = tiers.data;
  const tierLeft = (tid: string): number =>
    left.tiers.find((t) => t.tierId === tid)?.ticketsLeft ?? 0;
  const chosen = tierList.find((t) => t.id === tierId) ?? null;
  const ticketsLeft = chosen ? tierLeft(chosen.id) : left.ticketsLeft;
  const maxQuantity = Math.max(1, Math.min(ORDER_LIMITS.maxQuantity, ticketsLeft));
  const price = tierList.length > 0 ? chosen?.price : event.basePrice;
  const canConfirm = price !== undefined && phase.kind === 'choosing';

  const choose = (change: () => void): void => {
    change();
    requestId.current = null;
  };

  async function confirm(): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    requestId.current ??= crypto.randomUUID();
    setPhase({ kind: 'confirming' });
    try {
      const { data, response } = await api.POST('/events/{id}/orders', {
        params: { path: { id } },
        body: {
          ...(chosen ? { tierId: chosen.id } : {}),
          quantity: Math.min(quantity, maxQuantity),
          requestId: requestId.current,
        },
      });
      if (response.ok && data) setPhase({ kind: 'done', order: data as Order });
      else setPhase({ kind: 'choosing' });
    } catch {
      setPhase({ kind: 'choosing' });
    } finally {
      sending.current = false;
    }
  }

  if (phase.kind === 'done') return <Confirmation event={event} order={phase.order} />;

  return (
    <section aria-labelledby="get-tickets">
      <h2 id="get-tickets">Get tickets</h2>
      {tierList.length > 0 ? (
        <fieldset>
          <legend>Ticket type</legend>
          {tierList.map((t) => (
            <label key={t.id}>
              <input
                type="radio"
                name="tier"
                value={t.id}
                checked={tierId === t.id}
                onChange={() => choose(() => setTierId(t.id))}
              />{' '}
              {`${t.name}, ${usd(t.price)}, ${count(tierLeft(t.id))} left`}
            </label>
          ))}
        </fieldset>
      ) : (
        <p>{`${usd(event.basePrice)} each, ${count(left.ticketsLeft)} left`}</p>
      )}
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
      {price !== undefined && <p>{`Total: ${totalUsd(price, Math.min(quantity, maxQuantity))}`}</p>}
      <button type="button" disabled={!canConfirm} onClick={() => void confirm()}>
        {phase.kind === 'confirming' ? 'Confirming…' : 'Confirm order'}
      </button>
    </section>
  );
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
          <li key={t.id}>{t.code}</li>
        ))}
      </ul>
      <Link to="/my-tickets">See all my tickets</Link>
    </section>
  );
}
