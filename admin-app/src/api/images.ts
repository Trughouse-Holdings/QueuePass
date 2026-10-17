import type { EventImage } from '@queuepass/shared';
import { api, unwrap } from './client';

/**
 * Spec 014 (research R9): an event's images. One picture per request, in a `multipart/form-data`
 * body with one `file` part. The FormData is sent as is, so the browser sets the boundary.
 */
export const uploadEventImage = (eventId: string, file: File): Promise<EventImage> => {
  const form = new FormData();
  form.append('file', file);
  return unwrap(
    api.POST('/events/{id}/images', {
      params: { path: { id: eventId } },
      // The generated type describes the part, not the FormData that carries it.
      body: form as unknown as { file: string },
      bodySerializer: (body) => body,
    }),
  ) as Promise<EventImage>;
};

/** Permanent; the event's other images close the gap (US3). */
export const deleteEventImage = (eventId: string, imageId: string): Promise<void> =>
  unwrap(
    api.DELETE('/events/{id}/images/{imageId}', { params: { path: { id: eventId, imageId } } }),
  );

/** Every image of the event, in the new order (US3). */
export const reorderEventImages = (eventId: string, imageIds: string[]): Promise<EventImage[]> =>
  unwrap(
    api.PUT('/events/{id}/images/order', {
      params: { path: { id: eventId } },
      body: { imageIds },
    }),
  ) as Promise<EventImage[]>;
