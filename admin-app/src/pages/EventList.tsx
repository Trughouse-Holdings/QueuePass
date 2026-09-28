import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Event } from '@queuepass/shared';
import { listEvents } from '../api/events';
import { Notice } from '../components/Notice';

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Spec 002 FR-025 — the event list. Delete lives on the event page (spec 002 research R3). */
export function EventList(): React.ReactElement {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listEvents()
      .then(setEvents)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">Events</h1>
          <p className="page-sub">
            {events
              ? `${events.length} event${events.length === 1 ? '' : 's'} scheduled`
              : 'Loading…'}
          </p>
        </div>
        <Link to="/events/new" className="btn btn--primary">
          <span aria-hidden="true">+</span> Schedule event
        </Link>
      </div>

      <Notice />

      {error && (
        <div role="alert" className="banner banner--error">
          <span className="banner__icon" aria-hidden="true">
            ✕
          </span>
          <div className="banner__body">
            <strong>Could not load events</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <div className="card">
        {!events ? (
          <p className="loading">Loading events…</p>
        ) : events.length === 0 ? (
          <div className="empty">
            <div className="empty__icon" aria-hidden="true">
              ◷
            </div>
            <p className="empty__title">No events scheduled</p>
            <p className="empty__body">Schedule one against a venue to get started.</p>
            <Link to="/events/new" className="btn btn--primary">
              Schedule event
            </Link>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Venue</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Tickets</th>
                  <th>Base price</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="cell-strong">
                      <Link to={`/events/${e.id}`} className="rowlink">
                        {e.name}
                      </Link>
                    </td>
                    <td>
                      <span className="pill">{e.location.name}</span>
                    </td>
                    <td className="cell-time">{day(e.startsAt)}</td>
                    <td className="cell-time">
                      {clock(e.startsAt)} – {clock(e.endsAt)}
                    </td>
                    <td className="cell-num">{e.totalTicketCapacity.toLocaleString()}</td>
                    <td className="price">${e.basePrice}</td>
                    <td className="cell-action">
                      <Link to={`/events/${e.id}/edit`} className="rowlink">
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
