import type {
  Availability,
  LayoutInput,
  SeatingInput,
  SeatingLayout,
  SeatMap,
} from '@queuepass/shared';
import { api, unwrap } from './client';

/** Spec 007: venue seating layouts, reserved seating, and seat maps. */
const venuePath = (locationId: string) => ({ params: { path: { id: locationId } } });

export const getLayout = (locationId: string): Promise<SeatingLayout> =>
  unwrap(api.GET('/locations/{id}/layout', venuePath(locationId)));

export const replaceLayout = (locationId: string, input: LayoutInput): Promise<SeatingLayout> =>
  unwrap(api.PUT('/locations/{id}/layout', { ...venuePath(locationId), body: input }));

export const deleteLayout = (locationId: string): Promise<void> =>
  unwrap(api.DELETE('/locations/{id}/layout', venuePath(locationId)));

export const getSeatMap = (eventId: string): Promise<SeatMap> =>
  unwrap(api.GET('/events/{id}/seats', { params: { path: { id: eventId } } }));

export const updateSeating = (eventId: string, input: SeatingInput): Promise<SeatMap> =>
  unwrap(api.PUT('/events/{id}/seating', { params: { path: { id: eventId } }, body: input }));

/** Spec 006's availability: whether any ticket is sold decides if seating may still switch. */
export const getAvailability = (eventId: string): Promise<Availability> =>
  unwrap(api.GET('/events/{id}/availability', { params: { path: { id: eventId } } }));
