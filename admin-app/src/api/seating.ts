import type { LayoutInput, SeatingLayout } from '@queuepass/shared';
import { api, unwrap } from './client';

/** Spec 007: venue seating layouts. */
const venuePath = (locationId: string) => ({ params: { path: { id: locationId } } });

export const getLayout = (locationId: string): Promise<SeatingLayout> =>
  unwrap(api.GET('/locations/{id}/layout', venuePath(locationId)));

export const replaceLayout = (locationId: string, input: LayoutInput): Promise<SeatingLayout> =>
  unwrap(api.PUT('/locations/{id}/layout', { ...venuePath(locationId), body: input }));

export const deleteLayout = (locationId: string): Promise<void> =>
  unwrap(api.DELETE('/locations/{id}/layout', venuePath(locationId)));
