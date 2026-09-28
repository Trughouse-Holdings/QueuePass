import type { Event, EventInput, EventUpdate } from '@queuepass/shared';
import { api, unwrap } from './client';

export const listEvents = (locationId?: string): Promise<Event[]> =>
  unwrap(api.GET('/events', { params: { query: locationId ? { locationId } : {} } }));

export const getEvent = (id: string): Promise<Event> =>
  unwrap(api.GET('/events/{id}', { params: { path: { id } } }));

export const createEvent = (input: EventInput): Promise<Event> =>
  unwrap(api.POST('/events', { body: input }));

export const updateEvent = (id: string, input: EventUpdate): Promise<Event> =>
  unwrap(api.PATCH('/events/{id}', { params: { path: { id } }, body: input }));

/** Permanent. Frees the event's window at its venue (spec 002 FR-010). */
export const deleteEvent = (id: string): Promise<void> =>
  unwrap(api.DELETE('/events/{id}', { params: { path: { id } } }));
