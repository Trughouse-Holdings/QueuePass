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

const NO_CONNECTION =
  "Can't show the live code without a connection. Use your printed ticket with photo ID.";

/** What the page has loaded. The key is held in React state only, never in storage (FR-010). */
type PageState =
  | { kind: 'loading' }
  | { kind: 'ok'; order: MyOrder; key: Uint8Array; offset: number }
  | { kind: 'offline' }
  | { kind: 'missing' }
  | { kind: 'refused'; message: string }
  | { kind: 'failed' };

/**
 * Spec 018 US1 (FR-001, FR-002, FR-004, FR-009, FR-010; research R8): one ticket's live code,
 * which changes every 30 seconds on the Backend's clock. The ticket's key is asked for once,
 * alongside My tickets' orders for what to show; after that the page makes every code itself, so
 * it keeps working with no signal while it stays open. The key lives in this page's state only:
 * never in browser storage, a cookie, or the URL.
 */
export function EntryCode() {
  const { ticketId = '' } = useParams();
  const { api, signIn } = useAuth();
  const [page, setPage] = useState<PageState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPage({ kind: 'loading' });
    void (async () => {
      const sent = performance.now();
      let received = sent;
      try {
        const [orders, entryKey] = await Promise.all([
          api.GET('/me/orders'),
          api
            .GET('/me/tickets/{ticketId}/entry-key', { params: { path: { ticketId } } })
            .finally(() => (received = performance.now())),
        ]);
        if (cancelled) return;
        if (orders.response.status === 401 || entryKey.response.status === 401) {
          await signIn();
          return;
        }
        const order = orders.data?.find((o) => o.tickets.some((t) => t.id === ticketId));
        const bytes = entryKey.data ? keyFromBase64url(entryKey.data.key) : null;
        if (!orders.response.ok) {
          // A server error is not "no connection": the standard error, with Try again.
          setPage({ kind: 'failed' });
        } else if (entryKey.response.status === 404 || !order) {
          setPage({ kind: 'missing' });
        } else if (entryKey.response.status === 409) {
          const error = entryKey.error?.error;
          const reason = (error?.details as { reason?: string } | undefined)?.reason;
          setPage({
            kind: 'refused',
            message:
              reason === 'USED'
                ? 'This ticket was already used.'
                : reason === 'VOID'
                  ? 'This ticket was cancelled and refunded.'
                  : (error?.message ?? "This ticket can't be used."),
          });
        } else if (entryKey.data && bytes) {
          setPage({
            kind: 'ok',
            order,
            key: bytes,
            offset: measureOffset(entryKey.data.serverTime, sent, received),
          });
        } else {
          setPage({ kind: 'failed' });
        }
      } catch {
        // No answer from either request: the page opened after the signal went (FR-010). A reload
        // with no signal never gets here; it signs in through Keycloak first (research R8).
        if (!cancelled) setPage({ kind: 'offline' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, signIn, ticketId, attempt]);

  const back = <Link to="/my-tickets">Back to My tickets</Link>;
  // Asks for both again: a customer whose signal comes back in the queue needn't leave the page.
  const tryAgain = (
    <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
      Try again
    </button>
  );

  switch (page.kind) {
    case 'loading':
      return <p>Getting your entry code…</p>;
    case 'offline':
      return (
        <section>
          <p role="alert" className="banner banner--error">
            {NO_CONNECTION}
          </p>
          {tryAgain}
          {back}
        </section>
      );
    case 'refused':
      return (
        <section>
          <p role="alert">{page.message}</p>
          {back}
        </section>
      );
    case 'failed':
      return (
        <section>
          <ServiceUnreachable />
          {tryAgain}
        </section>
      );
    case 'missing':
      return (
        <section>
          <p>Ticket not found.</p>
          {back}
        </section>
      );
  }

  const { order, key } = page;
  const ticket = order.tickets.find((t) => t.id === ticketId);
  return (
    <section className="entry-code" aria-labelledby="entry-code-heading">
      <div className="entry-code__card card card--padded">
        <h1 id="entry-code-heading">{order.event.name}</h1>
        <LiveCode secret={key} offset={page.offset} ticketId={ticketId} />
        <p className="note">Show this at the gate. It changes every 30 seconds.</p>
        <dl>
          <dt>Name on ticket</dt>
          <dd>{order.holderName ?? 'No name on ticket'}</dd>
          <dt>Starts</dt>
          <dd>{when(order.event.startsAt, order.event.location.timeZone)}</dd>
          {ticket?.seat && (
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
  const [broken, setBroken] = useState(false);

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
    liveCode(secret, ticketId, tick.window).then(
      (text) => {
        if (!cancelled) setCode({ window: tick.window, text });
      },
      // No Web Crypto, as on a page that isn't a secure context: say so, don't wait forever.
      () => {
        if (!cancelled) setBroken(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [secret, ticketId, tick.window]);

  // At a boundary the previous code stays up for the few milliseconds the next one takes; it is
  // still inside its 5 seconds of grace (FR-008).
  if (broken) {
    return (
      <p role="alert" className="banner banner--error">
        Can&apos;t show the live code in this browser. Use your printed ticket with photo ID.
      </p>
    );
  }
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
