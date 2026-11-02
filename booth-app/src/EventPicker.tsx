import type { Event } from '@queuepass/shared';
import { DEFAULT_TIME_ZONE, formatEventTime, formatTimeOfDay, localDate } from '@queuepass/shared';
import { when } from './format';

/** The chosen event, kept per tab so a new sign-in keeps it (FR-007, research R11). */
export const EVENT_KEY = 'queuepass.booth.eventId';

/** Every access in try/catch: a blocked sessionStorage still lets the agent choose. */
export function savedEventId(): string | null {
  try {
    return sessionStorage.getItem(EVENT_KEY);
  } catch {
    return null;
  }
}

export function saveEventId(id: string | null): void {
  try {
    if (id === null) sessionStorage.removeItem(EVENT_KEY);
    else sessionStorage.setItem(EVENT_KEY, id);
  } catch {
    // The choice then lives only in this render; the agent is asked again next time.
  }
}

/** An event on the gate's list, and whether its check-in window has opened (spec 025). */
export interface GateEvent {
  event: Event;
  open: boolean;
}

/**
 * Spec 025 FR-014 (research R8), in place of 017's `openForEntry`: scheduled events that have not
 * ended, soonest start first, each open once the Backend's `entryOpensAt` has passed on `now`. An
 * event without `entryOpensAt` (a Backend before 025) counts as open.
 */
export function forTheGate(events: Event[], now: number): GateEvent[] {
  return events
    .filter((e) => e.status === 'SCHEDULED' && new Date(e.endsAt).getTime() > now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .map((event) => ({
      event,
      open: !event.entryOpensAt || new Date(event.entryOpensAt).getTime() <= now,
    }));
}

/**
 * Spec 025 FR-015: when a waiting event opens, in its venue's zone: the time alone when that is
 * today there, with the date otherwise.
 */
export function opensText(entryOpensAt: string, timeZone: string | undefined, now: number): string {
  const zone = timeZone || DEFAULT_TIME_ZONE;
  return localDate(entryOpensAt, zone) === localDate(now, zone)
    ? formatTimeOfDay(entryOpensAt, zone)
    : formatEventTime(entryOpensAt, zone);
}

export function EventPicker({
  events,
  now,
  onChoose,
}: {
  events: GateEvent[];
  now: number;
  onChoose: (event: Event) => void;
}) {
  return (
    <section aria-labelledby="pick-event">
      <h1 id="pick-event" className="page-title">
        Choose the event you are working
      </h1>
      {events.length === 0 ? (
        <p className="note">No event is open for entry.</p>
      ) : (
        <>
          {/* FR-018: the waiting events are still listed below. */}
          {!events.some((g) => g.open) && <p className="note">No event is open for entry yet.</p>}
          <ul className="event-choices" aria-label="Events">
            {events.map(({ event: e, open }) => {
              const label = `${e.name} · ${when(e.startsAt, e.location?.timeZone)}`;
              return (
                <li key={e.id}>
                  {open ? (
                    <button type="button" className="btn event-choice" onClick={() => onChoose(e)}>
                      {label}
                    </button>
                  ) : (
                    // FR-015 (research R8): not a control, so nothing to press, tab to, or tap;
                    // read as text, its state in words and shape, not color alone.
                    <div className="event-choice event-choice--waiting">
                      <span>{label}</span>{' '}
                      <span className="event-choice__state">
                        {`Not open yet · Opens ${opensText(e.entryOpensAt as string, e.location?.timeZone, now)}`}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
