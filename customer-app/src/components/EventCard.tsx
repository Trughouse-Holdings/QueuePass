import { Link } from 'react-router-dom';
import type { Event } from '@queuepass/shared';
import { ImageGallery } from '@queuepass/shared/web';
import { usd, when } from '../format';

/**
 * Spec 008 FR-005 (research R3): one event as a card, built only from what the event list already
 * has, so a list of cards needs no extra requests. Links carry `tap` for a 44-pixel target
 * (FR-006). Spec 014 FR-020 (research R12 to R14): the event's images, if any, across the top of
 * the card, loaded only while the card is on or near the screen.
 */
export function EventCard({ event: e }: { event: Event }) {
  const headingId = `event-${e.id}`;
  return (
    <article className="card card--padded event-card" aria-labelledby={headingId}>
      <ImageGallery
        eventId={e.id}
        eventName={e.name}
        images={e.images ?? []}
        variant="card"
        eventHref={`/events/${e.id}`}
      />
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
        <dd>{when(e.startsAt, e.location.timeZone)}</dd>
        <dt>Ends</dt>
        <dd>{when(e.endsAt, e.location.timeZone)}</dd>
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
