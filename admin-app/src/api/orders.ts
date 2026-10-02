import type { Cancellation, Order } from '@queuepass/shared';
import { api, unwrap } from './client';

const path = (eventId: string) => ({ params: { path: { id: eventId } } });

/** Spec 005 FR-007: every order for an event, with its tickets. */
export const listAttendees = (eventId: string): Promise<Order[]> =>
  unwrap(api.GET('/events/{id}/attendees', path(eventId)));

/** Spec 005 FR-008: irreversible. Callers MUST confirm with the admin first. */
export const cancelEvent = (eventId: string): Promise<Cancellation> =>
  unwrap(api.POST('/events/{id}/cancel', path(eventId)));
