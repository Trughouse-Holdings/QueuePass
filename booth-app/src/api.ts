import type { ApiClient } from '@queuepass/shared/web';

/**
 * Spec 017 (research R11): typed wrappers on the generated client (Constitution I), one per
 * operation the Ticket Booth app calls. Each returns openapi-fetch's `{ data, error, response }`,
 * so callers branch on the status and the envelope's `code`, never on message text.
 */

export const listEvents = (api: ApiClient) => api.GET('/events');

export const lookupEntryTicket = (api: ApiClient, eventId: string, code: string) =>
  api.POST('/events/{id}/entry/lookup', { params: { path: { id: eventId } }, body: { code } });

export const admitTicket = (
  api: ApiClient,
  eventId: string,
  ticketId: string,
  wholeOrder: boolean,
) =>
  api.POST('/events/{id}/entry/admit', {
    params: { path: { id: eventId } },
    body: { ticketId, wholeOrder },
  });
