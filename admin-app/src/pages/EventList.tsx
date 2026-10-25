import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  DEFAULT_TIME_ZONE,
  formatEventDate,
  formatTimeOfDay,
  type Event,
  type Location,
} from '@queuepass/shared';
import { listEvents, type EventFilters } from '../api/events';
import { listLocations } from '../api/locations';
import { Notice } from '../components/Notice';
import { until } from '../format';

/** Spec 020 research R12: an event's date and start in its venue's zone, with the abbreviation. */
const zoneOf = (e: Event): string => e.location.timeZone ?? DEFAULT_TIME_ZONE;
const day = (e: Event): string => formatEventDate(e.startsAt, zoneOf(e));
const clock = (e: Event): string => formatTimeOfDay(e.startsAt, zoneOf(e));

/** The filters as they appear in the address: human dates, `venue` for the venue id. */
interface UrlFilters {
  q: string;
  venue: string;
  from: string;
  to: string;
}
const KEYS: (keyof UrlFilters)[] = ['q', 'venue', 'from', 'to'];

const readUrl = (params: URLSearchParams): UrlFilters => ({
  q: params.get('q') ?? '',
  venue: params.get('venue') ?? '',
  from: params.get('from') ?? '',
  to: params.get('to') ?? '',
});

/**
 * Spec 020 FR-020 (research R15): the days are sent as typed, `fromDate` and `toDate`; the Backend
 * matches each event's start date in its venue's zone, both days included.
 */
const toApi = (f: UrlFilters): EventFilters => ({
  q: f.q.trim() || undefined,
  locationId: f.venue || undefined,
  fromDate: f.from || undefined,
  toDate: f.to || undefined,
});

/**
 * Spec 002 FR-025 — the event list; spec 004 US2 — search by name, venue, and date range, kept
 * in the address so reload and shared links keep the filters (FR-008). Delete lives on the
 * event page (spec 002 research R3).
 */
export function EventList(): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const applied = readUrl(params);
  const filtered = KEYS.some((k) => applied[k]);
  const [form, setForm] = useState<UrlFilters>(applied);
  const [formError, setFormError] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [venues, setVenues] = useState<Location[]>([]);
  const [error, setError] = useState<string | null>(null);
  const key = params.toString();

  useEffect(() => {
    listLocations()
      .then(setVenues)
      .catch(() => setVenues([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(null);
    listEvents(toApi(readUrl(new URLSearchParams(key))))
      .then((e) => !cancelled && setEvents(e))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const apply = (f: UrlFilters) => {
    const next = new URLSearchParams();
    for (const k of KEYS) {
      const v = f[k].trim();
      if (v) next.set(k, v);
    }
    setParams(next);
  };

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.from && form.to && form.from > form.to) {
      setFormError('From must be on or before To.');
      return;
    }
    setFormError(null);
    apply(form);
  };

  const clear = () => {
    const empty = { q: '', venue: '', from: '', to: '' };
    setForm(empty);
    setFormError(null);
    apply(empty);
  };

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">Events</h1>
          <p className="page-sub">
            {events
              ? `${events.length} event${events.length === 1 ? '' : 's'} ${filtered ? 'match' : 'scheduled'}`
              : 'Loading…'}
          </p>
        </div>
        <Link to="/events/new" className="btn btn--primary">
          <span aria-hidden="true">+</span> Schedule event
        </Link>
      </div>

      <Notice />

      <form role="search" className="card form" onSubmit={search}>
        <div className="field-row">
          <label className="field">
            Search events
            <input
              type="search"
              value={form.q}
              maxLength={200}
              placeholder="Event name"
              onChange={(e) => setForm({ ...form, q: e.target.value })}
            />
          </label>
          <label className="field">
            Venue
            <select
              value={form.venue}
              onChange={(e) => setForm({ ...form, venue: e.target.value })}
            >
              <option value="">All venues</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            From
            <input
              type="date"
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
            />
          </label>
          <label className="field">
            To
            <input
              type="date"
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
            />
          </label>
        </div>
        {formError && (
          <p role="alert" className="banner banner--error">
            {formError}
          </p>
        )}
        <div className="form__actions">
          <button type="submit" className="btn btn--primary">
            Search
          </button>
          <button type="button" className="btn" onClick={clear}>
            Clear
          </button>
        </div>
      </form>

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
        ) : events.length === 0 && filtered ? (
          <div className="empty">
            <p className="empty__title">No events match these filters.</p>
            <button type="button" className="btn" onClick={clear}>
              Clear filters
            </button>
          </div>
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
                      </Link>{' '}
                      {e.status === 'CANCELLED' && (
                        <span className="pill pill--danger">Cancelled</span>
                      )}
                    </td>
                    <td>
                      <span className="pill">{e.location.name}</span>
                    </td>
                    <td className="cell-time">{day(e)}</td>
                    <td className="cell-time">
                      {clock(e)} – {until(e.startsAt, e.endsAt, zoneOf(e))}
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
