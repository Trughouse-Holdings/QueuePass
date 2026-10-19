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
// Spec 014: event images, loaded with the token and shown as a rotating gallery.
export { useEventImage } from './event-images.js';
export type { EventImageState } from './event-images.js';
export { useGalleryRotation } from './use-gallery-rotation.js';
export type { GalleryRotation } from './use-gallery-rotation.js';
export { ImageGallery } from './image-gallery.js';
export type { ImageGalleryProps } from './image-gallery.js';
export { ImageViewer } from './image-viewer.js';
export type { ImageViewerProps } from './image-viewer.js';
