import type { Availability, EventSeating, SeatMap, VenueMapSection } from '@queuepass/shared';
import { api, unwrap } from './client';

/**
 * Spec 038 (research R8, R11): an event's seating as the event form edits it, and one section's
 * seat states. `007`'s layout and seating writes are gone (contract 2.0.0): a layout is the
 * `layouts` API's, and an event's seating is saved with the event.
 */
export const getEventSeating = (eventId: string): Promise<EventSeating> =>
  unwrap(api.GET('/events/{id}/seating', { params: { path: { id: eventId } } }));

/** Each seat of one section with its state at the event: the off-sale tool disables sold and held. */
export const getVenueMapSection = (eventId: string, sectionId: string): Promise<VenueMapSection> =>
  unwrap(
    api.GET('/events/{id}/venue-map/sections/{sectionId}', {
      params: { path: { id: eventId, sectionId } },
    }),
  ) as Promise<VenueMapSection>;

/** Spec 007's seat map, until the shared venue map replaces it (US6, T049). */
export const getSeatMap = (eventId: string): Promise<SeatMap> =>
  unwrap(api.GET('/events/{id}/seats', { params: { path: { id: eventId } } }));

/** Spec 006's availability: whether any ticket is sold decides if the seating may still change. */
export const getAvailability = (eventId: string): Promise<Availability> =>
  unwrap(api.GET('/events/{id}/availability', { params: { path: { id: eventId } } }));
