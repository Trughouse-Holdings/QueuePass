import type { EntryTicket, EntryTicketRef } from '@queuepass/shared';
import { seatLabel, when } from './format';

/** What the one status region shows: a ticket to decide on, a refusal, or what an admit did. */
export type Outcome =
  | { kind: 'ticket'; ticket: EntryTicket }
  | { kind: 'refused'; message: string; ticket?: EntryTicket }
  | { kind: 'admitted'; admitted: EntryTicketRef[]; alreadyUsed: EntryTicketRef[] }
  | { kind: 'notAdmitted' };

/**
 * Spec 017 FR-011 (research R5): one refusal reason, in words the agent can say to the customer.
 * The client formats the times; the Backend's details carry them (research R6).
 */
export function refusalText(
  state: string | undefined,
  info: {
    eventName?: string;
    eventStartsAt?: string;
    /** Spec 020 R16: the ticket's own event's venue zone (another venue's, for OTHER_EVENT). */
    eventTimeZone?: string;
    usedAt?: string;
    entryOpensAt?: string;
    /** Spec 020 R12: the gate event's venue zone, for the times of a ticket of this event. */
    timeZone?: string;
  },
): string {
  // A reason the app doesn't know, or one missing its time, never becomes "Invalid Date" or a
  // made-up reason: the agent is told plainly to look the ticket up again (FR-011's tone).
  const fallback = "This ticket couldn't be admitted. Look it up again.";
  switch (state) {
    case 'VOID':
      return 'Cancelled and refunded';
    case 'ENDED':
      return 'This event has ended';
    case 'OTHER_EVENT':
      return info.eventName && info.eventStartsAt
        ? `For ${info.eventName} on ${when(info.eventStartsAt, info.eventTimeZone)}, not this event`
        : fallback;
    case 'USED':
      return info.usedAt ? `Already used at ${when(info.usedAt, info.timeZone)}` : fallback;
    case 'NOT_OPEN':
      return info.entryOpensAt
        ? `Entry opens at ${when(info.entryOpensAt, info.timeZone)}`
        : fallback;
    default:
      return fallback;
  }
}

/**
 * Spec 018 FR-011 (research R9): why a live code itself was refused, with what to ask the holder
 * for. Nothing about the ticket: the Backend sends nothing about it.
 */
export const LIVE_CODE_REFUSALS: Record<string, string> = {
  LIVE_CODE_EXPIRED:
    'This live code has expired. Ask for the live code in the QueuePass app, or a printed ticket with photo ID.',
  LIVE_CODE_INVALID: 'Not a valid QueuePass code.',
};

/**
 * Spec 017 FR-014, FR-023, FR-024: the result of every lookup, admit, and refusal, in one
 * `role="status"` region that stays until the next lookup. Every state has a word and a symbol
 * (✓, ✕), never color alone.
 */
export function EntryResult({
  outcome,
  busy,
  onAdmit,
  onRefuse,
  onAnother,
  timeZone,
}: {
  outcome: Outcome | null;
  /** Spec 020 R12: the gate event's venue zone. */
  timeZone?: string;
  busy: boolean;
  onAdmit: (wholeOrder: boolean) => void;
  onRefuse: () => void;
  onAnother: () => void;
}) {
  return (
    <div role="status" className="entry-result">
      {outcome && body()}
    </div>
  );

  function body() {
    switch (outcome?.kind) {
      case 'ticket':
        return admittable(outcome.ticket);
      case 'refused':
        return (
          <section className="card card--padded result result--refused">
            {outcome.ticket && context(outcome.ticket)}
            <p className="result__headline">{`✕ ${outcome.message}`}</p>
            <p>No entry was recorded.</p>
            <button type="button" className="btn" onClick={onAnother}>
              Look up another
            </button>
          </section>
        );
      case 'admitted': {
        const n = outcome.admitted.length;
        const used = outcome.alreadyUsed;
        const headline =
          n === 1 && used.length === 0
            ? '✓ Admitted'
            : `✓ ${n} admitted` +
              (used.length > 0
                ? ` · ${used.length} already used at ${used.map((t) => when(t.usedAt, timeZone)).join(', ')}`
                : '');
        return (
          <section className="card card--padded result result--admitted">
            <p className="result__headline">{headline}</p>
            <p>{n === 1 && used.length === 0 ? 'The holder is admitted.' : null}</p>
            <button type="button" className="btn" onClick={onAnother}>
              Look up another
            </button>
          </section>
        );
      }
      case 'notAdmitted':
        return (
          <section className="card card--padded result result--refused">
            <p className="result__headline">✕ Not admitted</p>
            <p>No entry was recorded. The same ticket can be looked up and admitted later.</p>
            <button type="button" className="btn" onClick={onAnother}>
              Look up another
            </button>
          </section>
        );
      default:
        return null;
    }
  }

  /** The ticket as FR-010 shows it: event, type, seat, holder's name. */
  function context(t: EntryTicket) {
    return (
      <dl className="ticket-facts">
        <dt>Event</dt>
        <dd>{t.event.name}</dd>
        <dt>Ticket type</dt>
        <dd>{t.tierName ?? 'General admission'}</dd>
        {t.seat && (
          <>
            <dt>Seat</dt>
            <dd>{seatLabel(t.seat)}</dd>
          </>
        )}
        <dt>Name on ticket</dt>
        <dd>{t.holderName ?? 'No name on ticket'}</dd>
      </dl>
    );
  }

  function admittable(t: EntryTicket) {
    return (
      <section className="card card--padded result">
        {context(t)}
        {/* FR-015a: always say how many of the order's tickets are still unused. */}
        <p className="note">
          {`${t.unusedOnOrder} unused ${t.unusedOnOrder === 1 ? 'ticket' : 'tickets'} on this order`}
        </p>
        {/* Spec 018 FR-011: the Backend verified a live code in its window, so no ID check;
            a printed or typed code always gets 017's prompt (FR-014). */}
        <p className="result__prompt">
          {t.verifiedBy === 'LIVE_CODE'
            ? '✓ Live code verified. No ID check needed.'
            : t.holderName
              ? `Check a government-issued photo ID that shows: ${t.holderName}`
              : 'Check that the person shows a valid photo ID'}
        </p>
        <div className="result__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => onAdmit(false)}
          >
            Admit
          </button>
          {t.unusedOnOrder > 1 && (
            <button type="button" className="btn" disabled={busy} onClick={() => onAdmit(true)}>
              {`Admit all ${t.unusedOnOrder}`}
            </button>
          )}
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={onRefuse}>
            Refuse
          </button>
        </div>
      </section>
    );
  }
}
