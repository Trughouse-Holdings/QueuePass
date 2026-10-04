import { Link } from 'react-router-dom';
import type { Event } from '@queuepass/shared';
import { usd, when } from '../format';

/**
 * Spec 008 FR-005 (research R3): one event as a card, built only from what the event list already
 * has, so a list of cards needs no extra requests. Links carry `tap` for a 44-pixel target
 * (FR-006).
 */
export function EventCard({ event: e }: { event: Event }) {
  const headingId = `event-${e.id}`;
  return (
    <article className="card event-card" aria-labelledby={headingId}>
      <div className="event-card__head">
        <h2 id={headingId} className="event-card__title">
          <Link to={`/events/${e.id}`} className="tap">
            {e.name}
          </Link>
        </h2>
        {e.status === 'CANCELLED' && <span className="pill pill--danger">Cancelled</span>}
      </div>
      <dl className="event-card__facts">
        <dt>Starts</dt>
        <dd>{when(e.startsAt)}</dd>
        <dt>Ends</dt>
        <dd>{when(e.endsAt)}</dd>
        <dt>Venue</dt>
        <dd>
          <Link to={`/venues/${e.locationId}`} className="tap">
            {e.location.name}
          </Link>
        </dd>
        <dt>Price</dt>
        <dd className="price">{usd(e.basePrice)}</dd>
      </dl>
    </article>
  );
}

/** Cards side by side on a wide screen, one column on a phone (FR-006; research R3). */
export function EventCards({ events, label }: { events: Event[]; label: string }) {
  return (
    <ul className="card-grid" aria-label={label}>
      {events.map((e) => (
        <li key={e.id}>
          <EventCard event={e} />
        </li>
      ))}
    </ul>
  );
}
