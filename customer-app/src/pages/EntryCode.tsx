import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  keyFromBase64url,
  liveCode,
  windowAt,
  windowStartMs,
  type MyOrder,
} from '@queuepass/shared';
import { ServiceUnreachable, useAuth } from '@queuepass/shared/web';
import { TicketQr } from '../components/TicketQr';
import { seatLabel, when } from '../format';
import { measureOffset, serverNow } from '../live-code-clock';
import { useLoad } from '../use-load';

const NO_CONNECTION =
  "Can't show the live code without a connection. Use your printed ticket with photo ID.";

/** The entry key as this page holds it: in React state only, never in storage (FR-010). */
type KeyState =
  | { kind: 'loading' }
  | { kind: 'ok'; key: Uint8Array; offset: number }
  | { kind: 'offline' }
  | { kind: 'missing' }
  | { kind: 'refused'; message: string }
  | { kind: 'failed' };

/**
 * Spec 018 US1 (FR-001, FR-002, FR-004, FR-009, FR-010; research R8): one ticket's live code,
 * which changes every 30 seconds on the Backend's clock. The ticket's key is asked for once; after
 * that the page makes every code itself, so it keeps working with no signal while it stays open.
 * The key lives in this page's state only: never in browser storage, a cookie, or the URL.
 */
export function EntryCode() {
  const { ticketId = '' } = useParams();
  const { api, signIn } = useAuth();
  const orders = useLoad<MyOrder[]>('my-orders', (a) => a.GET('/me/orders'));
  const [key, setKey] = useState<KeyState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setKey({ kind: 'loading' });
    void (async () => {
      const sent = Date.now();
      try {
        const { data, error, response } = await api.GET('/me/tickets/{ticketId}/entry-key', {
          params: { path: { ticketId } },
        });
        const received = Date.now();
        if (cancelled) return;
        const bytes = response.ok && data ? keyFromBase64url(data.key) : null;
        if (data && bytes) {
          setKey({
            kind: 'ok',
            key: bytes,
            offset: measureOffset(data.serverTime, sent, received),
          });
        } else if (response.status === 401) {
          await signIn();
        } else if (response.status === 404) {
          setKey({ kind: 'missing' });
        } else if (response.status === 409) {
          const reason = (error?.error.details as { reason?: string } | undefined)?.reason;
          setKey({
            kind: 'refused',
            message:
              reason === 'USED'
                ? 'This ticket was already used.'
                : reason === 'VOID'
                  ? 'This ticket was cancelled and refunded.'
                  : (error?.error.message ?? "This ticket can't be used."),
          });
        } else {
          setKey({ kind: 'failed' });
        }
      } catch {
        if (!cancelled) setKey({ kind: 'offline' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, signIn, ticketId, attempt]);

  const back = <Link to="/my-tickets">Back to My tickets</Link>;

  if (orders.kind === 'unreachable' || key.kind === 'offline') {
    return (
      <section>
        <p className="banner banner--error">{NO_CONNECTION}</p>
        {back}
      </section>
    );
  }
  if (key.kind === 'refused') {
    return (
      <section>
        <p>{key.message}</p>
        {back}
      </section>
    );
  }
  if (key.kind === 'failed') {
    return (
      <section>
        <ServiceUnreachable />
        <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </section>
    );
  }

  const order =
    orders.kind === 'ok'
      ? orders.data.find((o) => o.tickets.some((t) => t.id === ticketId))
      : undefined;
  const ticket = order?.tickets.find((t) => t.id === ticketId);
  if (key.kind === 'missing' || orders.kind === 'missing' || (orders.kind === 'ok' && !ticket)) {
    return (
      <section>
        <p>Ticket not found.</p>
        {back}
      </section>
    );
  }
  if (key.kind === 'loading' || !order || !ticket) return <p>Getting your entry code…</p>;

  return (
    <section className="entry-code" aria-labelledby="entry-code-heading">
      <div className="entry-code__card card card--padded">
        <h1 id="entry-code-heading">{order.event.name}</h1>
        <LiveCode secret={key.key} offset={key.offset} ticketId={ticketId} />
        <p className="note">Show this at the gate. It changes every 30 seconds.</p>
        <dl>
          <dt>Name on ticket</dt>
          <dd>{order.holderName ?? 'No name on ticket'}</dd>
          <dt>Starts</dt>
          <dd>{when(order.event.startsAt)}</dd>
          {ticket.seat && (
            <>
              <dt>Seat</dt>
              <dd>{seatLabel(ticket.seat)}</dd>
            </>
          )}
        </dl>
      </div>
      {back}
    </section>
  );
}

/** How often the clock is read: a new window's code is drawn well within 1 second (FR-002). */
const TICK_MS = 250;

/**
 * The current window's code and its countdown, on the Backend's clock (FR-009). The countdown is
 * plain text outside any live region, so assistive technology never hears it tick (FR-004).
 */
function LiveCode({
  secret,
  offset,
  ticketId,
}: {
  secret: Uint8Array;
  offset: number;
  ticketId: string;
}) {
  const [tick, setTick] = useState(() => tickAt(offset));
  const [code, setCode] = useState<{ window: number; text: string } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      const next = tickAt(offset);
      setTick((t) => (t.window === next.window && t.secondsLeft === next.secondsLeft ? t : next));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [offset]);

  useEffect(() => {
    let cancelled = false;
    // A result for a window that has already passed is dropped.
    void liveCode(secret, ticketId, tick.window).then((text) => {
      if (!cancelled) setCode({ window: tick.window, text });
    });
    return () => {
      cancelled = true;
    };
  }, [secret, ticketId, tick.window]);

  // At a boundary the previous code stays up for the few milliseconds the next one takes; it is
  // still inside its 5 seconds of grace (FR-008).
  if (!code) return <p>Getting your entry code…</p>;
  return (
    <>
      <TicketQr
        code={code.text}
        label="Live entry code, changes every 30 seconds"
        className="ticket-qr--live"
      />
      <p className="entry-code__countdown">{`Changes in ${tick.secondsLeft} s`}</p>
    </>
  );
}

function tickAt(offset: number): { window: number; secondsLeft: number } {
  const now = serverNow(offset);
  const window = windowAt(now);
  return { window, secondsLeft: Math.ceil((windowStartMs(window + 1) - now) / 1000) };
}
