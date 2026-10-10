import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Event, Location } from '@queuepass/shared';
import { ServiceUnreachable } from '@queuepass/shared/web';
import { EventCards } from '../components/EventCard';
import { EventFilters } from '../components/EventFilters';
import {
  eventQuery,
  isFiltered,
  NO_FILTERS,
  readFilters,
  writeFilters,
  type Filters,
} from '../filters';
import { useLoad } from '../use-load';

/**
 * Spec 003 US1 (FR-001, FR-002): every event, in the order the Backend returns them, which is
 * soonest first (research R3). Spec 008 US1: narrowed by filters held in the page address and
 * applied by the Backend's search (spec 004), except Hide cancelled, which only changes what is
 * shown. Read-only.
 */
export function EventList() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const setFilters = useCallback(
    (next: Filters, opts?: { replace?: boolean }) => setParams(writeFilters(next), opts),
    [setParams],
  );

  const venues = useLoad<Location[]>('venues', (api) => api.GET('/locations'));
  const venueIds = venues.kind === 'ok' ? new Set(venues.data.map((v) => v.id)) : null;
  const query = eventQuery(filters, venueIds);
  const load = useLoad<Event[]>(`events:${JSON.stringify(query)}`, (api) =>
    api.GET('/events', { params: { query } }),
  );
  const shown =
    load.kind === 'ok'
      ? load.data.filter((e) => !(filters.hideCancelled && e.status === 'CANCELLED'))
      : [];

  return (
    <section>
      <h1 className="page-title">Events</h1>
      <EventFilters
        filters={filters}
        venues={venues.kind === 'ok' ? venues.data : []}
        onChange={setFilters}
      />
      {load.kind === 'loading' && <p className="loading">Loading…</p>}
      {(load.kind === 'unreachable' || load.kind === 'missing') && <ServiceUnreachable />}
      {load.kind === 'ok' &&
        (shown.length === 0 ? (
          isFiltered(filters) ? (
            <div className="empty">
              <p className="empty__title">No events match your filters.</p>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setFilters(NO_FILTERS)}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <p>Nothing is scheduled yet.</p>
          )
        ) : (
          <EventCards events={shown} label="Events" />
        ))}
    </section>
  );
}
