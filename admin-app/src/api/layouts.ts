import type {
  LayoutDetail,
  LayoutDuplicate,
  LayoutImport,
  LayoutLinesInput,
  LayoutSectionSeats,
  LayoutSummary,
  LayoutUpdate,
} from '@queuepass/shared';
import { api, unwrap } from './client';

/**
 * Spec 038 research R4: a venue's layouts, the eight operations of the contract. openapi-fetch
 * reads a `MapPoint` (`[x, y]`, `prefixItems`) as `number[]`; each result is given its schema's
 * own type, the tuple.
 */
const venue = (id: string) => ({ params: { path: { id } } });
const layout = (layoutId: string) => ({ params: { path: { layoutId } } });

export const listVenueLayouts = (locationId: string): Promise<LayoutSummary[]> =>
  unwrap(api.GET('/locations/{id}/layouts', venue(locationId)));

export const createVenueLayout = (
  locationId: string,
  input: LayoutLinesInput,
): Promise<LayoutDetail> =>
  unwrap(
    api.POST('/locations/{id}/layouts', { ...venue(locationId), body: input }),
  ) as Promise<LayoutDetail>;

/** A layout file, sent as read; problems come back as `LAYOUT_FILE_INVALID` (R5). */
export const importVenueLayout = (locationId: string, input: LayoutImport): Promise<LayoutDetail> =>
  unwrap(
    api.POST('/locations/{id}/layouts/import', { ...venue(locationId), body: input }),
  ) as Promise<LayoutDetail>;

export const getVenueLayout = (layoutId: string): Promise<LayoutDetail> =>
  unwrap(api.GET('/layouts/{layoutId}', layout(layoutId))) as Promise<LayoutDetail>;

export const getVenueLayoutSection = (
  layoutId: string,
  sectionId: string,
): Promise<LayoutSectionSeats> =>
  unwrap(
    api.GET('/layouts/{layoutId}/sections/{sectionId}', {
      params: { path: { layoutId, sectionId } },
    }),
  ) as Promise<LayoutSectionSeats>;

export const updateVenueLayout = (layoutId: string, input: LayoutUpdate): Promise<LayoutDetail> =>
  unwrap(
    api.PUT('/layouts/{layoutId}', { ...layout(layoutId), body: input }),
  ) as Promise<LayoutDetail>;

export const duplicateVenueLayout = (
  layoutId: string,
  input: LayoutDuplicate = {},
): Promise<LayoutDetail> =>
  unwrap(
    api.POST('/layouts/{layoutId}/duplicate', { ...layout(layoutId), body: input }),
  ) as Promise<LayoutDetail>;

export const deleteVenueLayout = (layoutId: string): Promise<void> =>
  unwrap(api.DELETE('/layouts/{layoutId}', layout(layoutId)));
