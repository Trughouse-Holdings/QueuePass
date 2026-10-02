import type { TicketTier, TicketTierInput, TicketTierUpdate } from '@queuepass/shared';
import { api, unwrap } from './client';

/** Spec 004: an event's ticket tiers. */
const path = (eventId: string) => ({ params: { path: { id: eventId } } });
const tierPath = (eventId: string, tierId: string) => ({
  params: { path: { id: eventId, tierId } },
});

export const listTiers = (eventId: string): Promise<TicketTier[]> =>
  unwrap(api.GET('/events/{id}/tiers', path(eventId)));

export const createTier = (eventId: string, input: TicketTierInput): Promise<TicketTier> =>
  unwrap(api.POST('/events/{id}/tiers', { ...path(eventId), body: input }));

export const updateTier = (
  eventId: string,
  tierId: string,
  input: TicketTierUpdate,
): Promise<TicketTier> =>
  unwrap(api.PATCH('/events/{id}/tiers/{tierId}', { ...tierPath(eventId, tierId), body: input }));

export const deleteTier = (eventId: string, tierId: string): Promise<void> =>
  unwrap(api.DELETE('/events/{id}/tiers/{tierId}', tierPath(eventId, tierId)));
