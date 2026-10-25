import type { Event } from '@queuepass/shared';
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

/** Scheduled events that have not ended, soonest first (FR-007). */
export function openForEntry(events: Event[]): Event[] {
  const now = Date.now();
  return events
    .filter((e) => e.status === 'SCHEDULED' && new Date(e.endsAt).getTime() > now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

export function EventPicker({
  events,
  onChoose,
}: {
  events: Event[];
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
        <ul className="event-choices" aria-label="Events">
          {events.map((e) => (
            <li key={e.id}>
              <button type="button" className="btn event-choice" onClick={() => onChoose(e)}>
                {`${e.name} · ${when(e.startsAt, e.location?.timeZone)}`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
