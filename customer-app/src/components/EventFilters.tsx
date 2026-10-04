import { useEffect, useState } from 'react';
import type { Location } from '@queuepass/shared';
import type { Filters } from '../filters';

/** Typing settles for this long before the list searches (spec 008 Assumptions). */
const SEARCH_PAUSE_MS = 300;

/**
 * Spec 008 US1 (FR-001): name search, venue, dates, and Hide cancelled. Every change goes
 * straight to the page address through `onChange`, except typing, which waits for a pause.
 */
export function EventFilters({
  filters,
  venues,
  onChange,
}: {
  filters: Filters;
  venues: Location[];
  onChange: (next: Filters, opts?: { replace?: boolean }) => void;
}) {
  const [text, setText] = useState(filters.q);

  // The address can change without typing (Clear filters, back button): follow it.
  useEffect(() => setText(filters.q), [filters.q]);

  useEffect(() => {
    if (text.trim() === filters.q) return;
    const timer = setTimeout(
      () => onChange({ ...filters, q: text.trim() }, { replace: true }),
      SEARCH_PAUSE_MS,
    );
    return () => clearTimeout(timer);
  }, [text, filters, onChange]);

  return (
    <form className="filters card" role="search" onSubmit={(e) => e.preventDefault()}>
      <div className="field">
        <label htmlFor="filter-q">Search events</label>
        <input
          id="filter-q"
          type="search"
          value={text}
          placeholder="Event name"
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="filter-venue">Venue</label>
        <select
          id="filter-venue"
          value={venues.some((v) => v.id === filters.venue) ? filters.venue : ''}
          onChange={(e) => onChange({ ...filters, venue: e.target.value })}
        >
          <option value="">All venues</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="filter-from">From</label>
          <input
            id="filter-from"
            type="date"
            value={filters.from}
            onChange={(e) => onChange({ ...filters, from: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="filter-to">To</label>
          <input
            id="filter-to"
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => onChange({ ...filters, to: e.target.value })}
          />
        </div>
      </div>
      <label className="choice">
        <input
          type="checkbox"
          checked={filters.hideCancelled}
          onChange={(e) => onChange({ ...filters, hideCancelled: e.target.checked })}
        />
        Hide cancelled
      </label>
    </form>
  );
}
