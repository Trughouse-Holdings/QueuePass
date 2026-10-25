import type { Event, EventInput, EventUpdate } from '@queuepass/shared';
import { api, unwrap } from './client';

/**
 * Spec 004 FR-006 filters; every one optional. Spec 020 (research R15): `fromDate` and `toDate`
 * are days (`YYYY-MM-DD`), matched against each event's start date in its venue's zone.
 */
export interface EventFilters {
  locationId?: string;
  q?: string;
  fromDate?: string;
  toDate?: string;
}

export const listEvents = (filters: EventFilters = {}): Promise<Event[]> => {
  const query = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as EventFilters;
  return unwrap(api.GET('/events', { params: { query } }));
};

export const getEvent = (id: string): Promise<Event> =>
  unwrap(api.GET('/events/{id}', { params: { path: { id } } }));

export const createEvent = (input: EventInput): Promise<Event> =>
  unwrap(api.POST('/events', { body: input }));

export const updateEvent = (id: string, input: EventUpdate): Promise<Event> =>
  unwrap(api.PATCH('/events/{id}', { params: { path: { id } }, body: input }));

/** Permanent. Frees the event's window at its venue (spec 002 FR-010). */
export const deleteEvent = (id: string): Promise<void> =>
  unwrap(api.DELETE('/events/{id}', { params: { path: { id } } }));
