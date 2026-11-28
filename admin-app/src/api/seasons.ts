import type { ApiComponents } from '@queuepass/shared';
import { api, unwrap } from './client';

/** Spec 041 (contract 2.2.0): the Season resource, as the Admin app reads and writes it. */
export type Season = ApiComponents['schemas']['Season'];
export type SeasonInput = ApiComponents['schemas']['SeasonInput'];
export type SeasonCancellation = ApiComponents['schemas']['SeasonCancellation'];
export type Sport = ApiComponents['schemas']['Sport'];

const path = (id: string) => ({ params: { path: { id } } });

/** Admins get every Season, drafts and cancelled ones included (research R3). */
export const listSeasons = (): Promise<Season[]> => unwrap(api.GET('/seasons'));

export const getSeason = (id: string): Promise<Season> =>
  unwrap(api.GET('/seasons/{id}', path(id)));

/** Saved as a draft, with its events and prices, in one step. */
export const createSeason = (input: SeasonInput): Promise<Season> =>
  unwrap(api.POST('/seasons', { body: input }));

/** The whole Season, all or nothing. */
export const updateSeason = (id: string, input: SeasonInput): Promise<Season> =>
  unwrap(api.PUT('/seasons/{id}', { ...path(id), body: input }));

/** Drafts only; its events can then join another Season (FR-008). */
export const deleteSeason = (id: string): Promise<void> =>
  unwrap(api.DELETE('/seasons/{id}', path(id)));

export const publishSeason = (id: string): Promise<Season> =>
  unwrap(api.POST('/seasons/{id}/publish', path(id)));

/** FR-014: irreversible. Callers MUST confirm first, saying how many passes will be refunded. */
export const cancelSeason = (id: string): Promise<SeasonCancellation> =>
  unwrap(api.POST('/seasons/{id}/cancel', path(id)));
