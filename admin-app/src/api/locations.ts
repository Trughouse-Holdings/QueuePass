import type { Location, LocationInput, LocationUpdate } from '@queuepass/shared';
import { api, unwrap } from './client';

export const listLocations = (): Promise<Location[]> => unwrap(api.GET('/locations'));

export const getLocation = (id: string): Promise<Location> =>
  unwrap(api.GET('/locations/{id}', { params: { path: { id } } }));

export const createLocation = (input: LocationInput): Promise<Location> =>
  unwrap(api.POST('/locations', { body: input }));

export const updateLocation = (id: string, input: LocationUpdate): Promise<Location> =>
  unwrap(api.PATCH('/locations/{id}', { params: { path: { id } }, body: input }));

/** Permanent. Refused with 409 VENUE_HAS_EVENTS while events remain (spec 002 FR-004). */
export const deleteLocation = (id: string): Promise<void> =>
  unwrap(api.DELETE('/locations/{id}', { params: { path: { id } } }));
