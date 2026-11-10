import { useCallback, useRef, useState } from 'react';
import type { ErrorEnvelope, Reservation } from '@queuepass/shared';
import { useAuth } from '@queuepass/shared/web';
import { limitedFor } from './use-buy';
import type { ChosenSeat } from './components/SeatPicker';

export type SeatAction = 'hold' | 'release';

/** One click's request: hold or release one seat. */
export interface QueuedAction {
  kind: SeatAction;
  seat: ChosenSeat;
  key: string;
}

/** What the page does with each answer; called with the action it answers. */
export interface HoldQueueHandlers {
  /** Whether the seat is held, as the page shows the reservation now. */
  isHeld(seat: ChosenSeat): boolean;
  /** Done: the reservation as the Backend now has it (`null`: it ended). */
  onDone(action: QueuedAction, reservation: Reservation | null, created: boolean): void;
  /** Refused for a reason of its own (taken, the 2-minute wait, a limit, …). */
  onRefused(action: QueuedAction, error: ErrorEnvelope | undefined): void;
  /** A hold refused for the hold allowance (spec 026), with the seconds to wait. */
  onLimited(action: QueuedAction, seconds: number): void;
  /** No answer: the seat goes back to what it was, and the page loads what is true again. */
  onNoAnswer(action: QueuedAction): void;
  /** `401`: the queue is cleared; the page signs in again. */
  onSignedOut(): void;
}

export const placeKey = (s: { sectionId: string; row: number; seat: number }): string =>
  `${s.sectionId}-${s.row}-${s.seat}`;

const opposite = (kind: SeatAction): SeatAction => (kind === 'hold' ? 'release' : 'hold');

/**
 * Spec 033 FR-007 (research R6): the click queue. Each click on a seat becomes one hold or release
 * request; they are sent one at a time, in click order, never the same seat twice:
 *
 * - a click on a seat with a queued, unsent action removes it (nothing is sent for it);
 * - a click on a seat whose request is in flight queues the opposite action, sent after the answer;
 * - when an action is refused or unanswered, the opposite action queued behind it for the same seat
 *   is dropped; a hold refused for the allowance (`429`) drops every queued hold (releases go on);
 *   `401` clears the queue.
 *
 * `pending` tells, for each seat with a queued or in-flight action, what it will be: held
 * (`hold`) or open (`release`). The page adopts each answer as it comes, with its own `lastWrite`
 * guard against older reads.
 */
export function useHoldQueue(eventId: string, handlers: HoldQueueHandlers) {
  const { api } = useAuth();
  const queue = useRef<QueuedAction[]>([]);
  const inFlight = useRef<QueuedAction | null>(null);
  const latest = useRef(handlers);
  latest.current = handlers;
  const [, setVersion] = useState(0);
  const changed = (): void => setVersion((n) => n + 1);

  const send = useCallback(
    async (action: QueuedAction): Promise<void> => {
      const h = latest.current;
      const { sectionId, row, seat } = action.seat;
      const body = { seats: [{ sectionId, row, seat }] };
      /** Drops the queued actions on this seat (or every queued hold) that `keep` refuses. */
      const drop = (keep: (q: QueuedAction) => boolean): void => {
        queue.current = queue.current.filter(keep);
      };
      const dropOpposite = (): void =>
        drop((q) => !(q.key === action.key && q.kind === opposite(action.kind)));
      try {
        if (action.kind === 'hold') {
          const { data, error, response } = await api.POST('/events/{id}/reservation', {
            params: { path: { id: eventId } },
            body,
          });
          const limited = limitedFor(response, error);
          if (response.ok && data) h.onDone(action, data, response.status === 201);
          else if (response.status === 401) {
            queue.current = [];
            h.onSignedOut();
          } else if (limited !== null) {
            // Every queued hold would be refused too; releases go on (they are never limited).
            drop((q) => q.kind !== 'hold' && q.key !== action.key);
            h.onLimited(action, limited);
          } else {
            dropOpposite();
            h.onRefused(action, error as ErrorEnvelope | undefined);
          }
        } else {
          const { data, error, response } = await api.POST('/events/{id}/reservation/release', {
            params: { path: { id: eventId } },
            body,
          });
          if (response.ok) h.onDone(action, data?.reservation ?? null, false);
          else if (response.status === 401) {
            queue.current = [];
            h.onSignedOut();
          } else {
            dropOpposite();
            h.onRefused(action, error as ErrorEnvelope | undefined);
          }
        }
      } catch {
        dropOpposite();
        h.onNoAnswer(action);
      }
    },
    [api, eventId],
  );

  const pump = useCallback((): void => {
    if (inFlight.current || queue.current.length === 0) return;
    const next = queue.current.shift()!;
    inFlight.current = next;
    changed();
    void send(next).finally(() => {
      inFlight.current = null;
      changed();
      pump();
    });
  }, [send]);

  const click = (seat: ChosenSeat): void => {
    const key = placeKey(seat);
    const queued = queue.current.findIndex((q) => q.key === key);
    if (queued >= 0) {
      // Not sent yet: cancelled, so nothing is sent for this click or the one it undoes.
      queue.current.splice(queued, 1);
    } else if (inFlight.current?.key === key) {
      queue.current.push({ kind: opposite(inFlight.current.kind), seat, key });
    } else {
      queue.current.push({ kind: latest.current.isHeld(seat) ? 'release' : 'hold', seat, key });
    }
    changed();
    pump();
  };

  // What each seat will be once its actions are answered: the last one queued, or the one in flight.
  const pending = new Map<string, SeatAction>();
  if (inFlight.current) pending.set(inFlight.current.key, inFlight.current.kind);
  for (const q of queue.current) pending.set(q.key, q.kind);

  return {
    click,
    pending,
    /** Whether any action is queued or in flight. */
    busy: inFlight.current !== null || queue.current.length > 0,
  };
}
