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
  state: string,
  info: { eventName?: string; eventStartsAt?: string; usedAt?: string; entryOpensAt?: string },
): string {
  switch (state) {
    case 'VOID':
      return 'Cancelled and refunded';
    case 'OTHER_EVENT':
      return `For ${info.eventName} on ${when(info.eventStartsAt ?? '')}, not this event`;
    case 'USED':
      return `Already used at ${when(info.usedAt ?? '')}`;
    case 'NOT_OPEN':
      return `Entry opens at ${when(info.entryOpensAt ?? '')}`;
    default:
      return 'This event has ended';
  }
}

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
}: {
  outcome: Outcome | null;
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
                ? ` · ${used.length} already used at ${used.map((t) => when(t.usedAt)).join(', ')}`
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
        {t.unusedOnOrder > 1 && (
          <p className="note">{`${t.unusedOnOrder} unused tickets on this order`}</p>
        )}
        <p className="result__prompt">
          {t.holderName
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
