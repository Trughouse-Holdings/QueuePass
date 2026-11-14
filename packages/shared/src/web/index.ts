// @queuepass/shared/web — sign-in and the stub pages shared by all three front ends
// (spec 001 research R9). React is a peer dependency; the Backend never imports this.
export { AuthProvider, createUserManager, useAuth } from './auth-provider.js';
export type { Auth, AuthStatus, AuthProviderProps, UserManagerLike } from './auth-provider.js';
export { RequireRole } from './require-role.js';
export { LogoutButton } from './logout-button.js';
export { HelloPage } from './hello-page.js';
export type { GreetingPath } from './hello-page.js';
export { WrongRole } from './wrong-role.js';
export { ServiceUnreachable } from './service-unreachable.js';
export { AddressLink } from './address-link.js';
export { apiBaseUrl, createApiClient } from './api-client.js';
export type { ApiClient } from './api-client.js';
export { openSeatStream, RECONNECT_DELAYS_MS } from './seat-stream.js';
export type {
  SeatStream,
  SeatStreamStatus,
  StreamSeatMapChange,
  StreamVenueMap,
} from './seat-stream.js';
export { useSeatStream } from './use-seat-stream.js';
export type {
  LiveSeats,
  LiveSeatStatus,
  MyReservation,
  SeatStreamOptions,
} from './use-seat-stream.js';
// Spec 014: event images, loaded with the token and shown as a rotating gallery.
export { useEventImage } from './event-images.js';
export type { EventImageState } from './event-images.js';
export { useGalleryRotation } from './use-gallery-rotation.js';
export type { GalleryRotation } from './use-gallery-rotation.js';
export { ImageGallery } from './image-gallery.js';
export type { ImageGalleryProps } from './image-gallery.js';
export { ImageViewer } from './image-viewer.js';
export type { ImageViewerProps } from './image-viewer.js';
// Spec 038: the venue map's geometry and a layout's preview (research R13, R15).
export { bounds, centroid, outlinePath, sectionViewBox } from './venue-map/map-geometry.js';
export type { Bounds, Point } from './venue-map/map-geometry.js';
export { LayoutPreview } from './venue-map/layout-preview.js';
export type { PreviewLayout } from './venue-map/layout-preview.js';
// Spec 038 US3 (T039): the venue map, its state, its pan and zoom (research R11 to R13).
export { VenueMap } from './venue-map/venue-map.js';
export type { MapSeat, SeatView, ShownState, VenueMapProps } from './venue-map/venue-map.js';
export { Legend } from './venue-map/legend.js';
export { PriceFilter, usePriceFilter, wholeDollars } from './venue-map/price-filter.js';
export { SectionView, mapSeatOf, seatLook, seatTip } from './venue-map/section-view.js';
export type { SeatLook } from './venue-map/section-view.js';
export { SectionsList } from './venue-map/sections-list.js';
export type { SectionsListProps } from './venue-map/sections-list.js';
export {
  EMPTY_MAP_STATE,
  formatPrice,
  inRange,
  mapReducer,
  needsLoad,
  openSeatsIn,
  priceCents,
  priceRangeOf,
  sectionLevel,
} from './venue-map/map-state.js';
export type {
  LoadedSection,
  MapAction,
  MapLevel,
  MapSectionSummary,
  MapState,
  PriceRange,
} from './venue-map/map-state.js';
export {
  MAX_ZOOM,
  clientToMap,
  fitView,
  panBy,
  pinchView,
  usePanZoom,
  zoomAt,
} from './venue-map/use-pan-zoom.js';
export type { PanZoom, View } from './venue-map/use-pan-zoom.js';
