import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  rateLimitMessage,
  type ErrorEnvelope,
  type Order,
  type OrderInput,
  type RateLimitedAction,
} from '@queuepass/shared';
import { useAuth } from '@queuepass/shared/web';

/**
 * Spec 026 (research R6): a wait out of a refusal for the limit. `deadline` is by this browser's
 * monotonic clock, from the Backend's seconds; `left` is the N shown.
 */
export interface Wait {
  deadline: number;
  left: number;
}
export type Waits = Partial<Record<RateLimitedAction, Wait>>;

/** Spec 026 FR-008: the seconds to wait, when a refusal is one for the limit; otherwise null. */
export function limitedFor(response: Response, error: ErrorEnvelope | undefined): number | null {
  if (response.status !== 429 || error?.error?.code !== 'RATE_LIMITED') return null;
  const n = error.error.details?.retryAfterSeconds;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** What `useWaits` gives a page: its waits, the one announcement, and how to start a wait. */
export interface WaitsApi {
  waits: Waits;
  /** FR-013 (independent review M2, M3): the text of the one live region, or null. */
  announcement: string | null;
  start(kind: RateLimitedAction, seconds: number, pressed?: RefObject<HTMLElement | null>): void;
}

/**
 * Spec 026 FR-011 to FR-013 (research R6): the waits out of refusals for the limit, buying and
 * holding apart, counting down once a second from the Backend's N; the message of the latest
 * refusal, kept for the one live region until its wait ends, so it is said once however often the
 * countdown above its control unmounts and mounts again; and focus back on the control pressed if
 * it went to the page. Moved out of `GetTickets` by spec 033 (research R8), so the cart waits the
 * same way.
 */
export function useWaits(): WaitsApi {
  const [waits, setWaits] = useState<Waits>({});
  const [announcement, setAnnouncement] = useState<{
    kind: RateLimitedAction;
    text: string;
  } | null>(null);
  const refocus = useRef<RefObject<HTMLElement | null> | null>(null);
  const waiting = waits.BUY !== undefined || waits.HOLD !== undefined;

  // FR-011: N counts down once a second, measured from the Backend's N; at 0 the wait ends.
  useEffect(() => {
    if (!waiting) return;
    const tick = (): void =>
      setWaits((all) => {
        const next: Waits = {};
        let changed = false;
        for (const kind of ['BUY', 'HOLD'] as const) {
          const w = all[kind];
          if (!w) continue;
          const left = Math.ceil((w.deadline - performance.now()) / 1000);
          if (left <= 0) changed = true;
          else if (left !== w.left) {
            next[kind] = { ...w, left };
            changed = true;
          } else next[kind] = w;
        }
        return changed ? next : all;
      });
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [waiting]);

  useEffect(() => {
    if (announcement && !waits[announcement.kind]) setAnnouncement(null);
  }, [waits, announcement]);

  // FR-013: a button natively disabled while confirming may have lost focus to the page; once it
  // is back, focus returns to it. A layout effect, so focus moves in the same commit that shows the
  // wait, never a frame later.
  useLayoutEffect(() => {
    const target = refocus.current?.current;
    if (!target) return;
    refocus.current = null;
    target.focus();
  });

  return {
    waits,
    announcement: announcement?.text ?? null,
    start: (kind, seconds, pressed) => {
      setWaits((all) => ({
        ...all,
        [kind]: { deadline: performance.now() + seconds * 1000, left: seconds },
      }));
      setAnnouncement({ kind, text: rateLimitMessage(seconds) });
      const active = document.activeElement;
      if (pressed && (active === null || active === document.body)) refocus.current = pressed;
    },
  };
}

export type BuyPhase =
  | { kind: 'choosing' }
  // `checking`: Check again from the unknown outcome, which keeps its banner mounted meanwhile, so
  // the banner (an alert) is not announced again (spec 026, independent review M2).
  | { kind: 'confirming'; checking?: boolean }
  | { kind: 'done'; order: Order }
  // No answer, or a server error: the order may or may not exist (spec 006 edge cases).
  | { kind: 'unknown' };

/** How a purchase attempt ended, for the page to show what it means. */
export type BuyOutcome =
  | { kind: 'done'; order: Order }
  | { kind: 'refused'; error: ErrorEnvelope | undefined }
  | { kind: 'limited' }
  | { kind: 'unknown' }
  | { kind: 'signed-out' }
  | { kind: 'busy' };

/**
 * Spec 006, 015 FR-006, 017, 026 (research R8 of spec 033): one purchase of one event, as Confirm
 * order and Confirm purchase did it in `GetTickets` and the cart's Buy tickets now does it:
 *
 * - one request id per purchase, made on the first press and kept, so Check again never places a
 *   second order; a refusal ends the purchase (the next press is a new one), a refusal for the
 *   limit does not;
 * - `401`: back through sign-in (nothing was recorded);
 * - `429` for the limit: the buy wait, back where the press came from, focus kept;
 * - `5xx` or no answer: the unknown outcome, with Check again.
 */
export function useBuy(eventId: string, waits: WaitsApi) {
  const { api, signIn } = useAuth();
  const [phase, setPhase] = useState<BuyPhase>({ kind: 'choosing' });
  const requestId = useRef<string | null>(null);
  // Set synchronously, so a second click before React re-renders sends nothing.
  const sending = useRef(false);

  async function buy(
    body: Omit<OrderInput, 'requestId'>,
    pressed: RefObject<HTMLElement | null>,
  ): Promise<BuyOutcome> {
    // Spec 026 FR-013: waiting out the limit, the buying buttons do nothing.
    if (sending.current || waits.waits.BUY) return { kind: 'busy' };
    sending.current = true;
    requestId.current ??= crypto.randomUUID();
    // Spec 026 FR-014: a refusal for the limit returns to where the press came from.
    const from: BuyPhase = phase.kind === 'unknown' ? { kind: 'unknown' } : { kind: 'choosing' };
    setPhase({ kind: 'confirming', checking: phase.kind === 'unknown' });
    try {
      const { data, error, response } = await api.POST('/events/{id}/orders', {
        params: { path: { id: eventId } },
        body: { ...body, requestId: requestId.current },
      });
      const limited = limitedFor(response, error);
      if (response.ok && data) {
        setPhase({ kind: 'done', order: data as Order });
        return { kind: 'done', order: data as Order };
      }
      if (limited !== null) {
        // Spec 026 FR-012, FR-014: nothing was recorded. The same purchase (its requestId) is
        // kept, so Check again still never places a second order.
        setPhase(from);
        waits.start('BUY', limited, pressed);
        return { kind: 'limited' };
      }
      if (response.status === 401) {
        // The token is checked before any ordering rule, so nothing was recorded.
        setPhase({ kind: 'choosing' });
        await signIn();
        return { kind: 'signed-out' };
      }
      if (response.status >= 500) {
        setPhase({ kind: 'unknown' });
        return { kind: 'unknown' };
      }
      // Refused: nothing was recorded. The next press is a new purchase.
      requestId.current = null;
      setPhase({ kind: 'choosing' });
      return { kind: 'refused', error: error as ErrorEnvelope | undefined };
    } catch {
      setPhase({ kind: 'unknown' });
      return { kind: 'unknown' };
    } finally {
      sending.current = false;
    }
  }

  return {
    phase,
    buy,
    /** A change to what is bought starts a new purchase (a new request id). */
    reset: (): void => {
      requestId.current = null;
    },
  };
}
