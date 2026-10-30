// Spec 022 (research R6, FR-004): data a scenario does not itself walk is set up through the
// Backend's API, with the access token the app itself sent after a real sign-in on Keycloak's
// page. No other credential, no direct-grant client, no bypass. Request shapes are the contract's
// (contracts/openapi.yaml), through the generated types.
import { expect, request, type APIRequestContext, type Page, type Request } from '@playwright/test';
import type { components } from '../../packages/shared/src/api-schema';
import { API_BASE } from './apps';
import { zoned } from './time';

type Schemas = components['schemas'];
export type Location = Schemas['Location'];
export type SeatingLayout = Schemas['SeatingLayout'];
export type Event = Schemas['Event'];
export type TicketTier = Schemas['TicketTier'];
export type Order = Schemas['Order'];
export type Place = Pick<Schemas['LocationInput'], 'street' | 'city' | 'state' | 'zip'>;

/** The app's first request to the API that carries a token. */
const authorized = (req: Request): boolean =>
  req.url().startsWith(`${API_BASE}/`) && !!req.headers()['authorization'];

/** A signed-in user's API: the app's own token, refreshed once from the page on a 401. */
export class Api {
  private constructor(
    private readonly page: Page,
    private ctx: APIRequestContext,
  ) {}

  /**
   * Signs in with `signInFn` while listening for the app's first authorized API request, which
   * usually goes out before sign-in returns (research R6); reloads once if none came.
   */
  static async as(page: Page, signInFn: () => Promise<void>): Promise<Api> {
    const first = page.waitForRequest(authorized, { timeout: 30_000 });
    await signInFn();
    let header: string | undefined;
    try {
      header = (await first).headers()['authorization'];
    } catch {
      header = await Api.tokenFromReload(page);
    }
    return new Api(page, await Api.context(header));
  }

  private static async tokenFromReload(page: Page): Promise<string> {
    const next = page.waitForRequest(authorized, { timeout: 30_000 });
    await page.reload();
    return (await next).headers()['authorization'];
  }

  private static context(authorization: string): Promise<APIRequestContext> {
    return request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { authorization } });
  }

  /** One call; on a 401 (an expired token) the page is reloaded for a fresh one, once. */
  async call<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    data?: unknown,
  ): Promise<T> {
    let res = await this.ctx.fetch(path, { method, data });
    if (res.status() === 401) {
      await this.ctx.dispose();
      this.ctx = await Api.context(await Api.tokenFromReload(this.page));
      res = await this.ctx.fetch(path, { method, data });
    }
    const text = await res.text();
    expect(res.ok(), `${method} ${path} answered ${res.status()}: ${text}`).toBe(true);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

/** A venue at one of the stand-in's addresses (research R4); seated when `sections` are given. */
export async function createVenue(
  api: Api,
  place: Place,
  name: string,
  sections?: Schemas['SectionInput'][],
): Promise<Location & { layout?: SeatingLayout }> {
  const venue = await api.call<Location>('POST', '/locations', {
    name,
    ...place,
    seatingCapacity: 500,
  } satisfies Schemas['LocationInput']);
  expect(venue.addressVerified, `${name}: the stand-in should verify ${place.street}`).toBe(true);
  if (!sections) return venue;
  const layout = await api.call<SeatingLayout>('PUT', `/locations/${venue.id}/layout`, {
    sections,
  } satisfies Schemas['LayoutInput']);
  return { ...venue, layout };
}

export interface EventSetup {
  name: string;
  startsAt: Date;
  endsAt: Date;
  capacity?: number;
  basePrice?: string;
  maxTicketsPerCustomer?: number;
}

/** An event at the venue, its times sent in the venue's zone with its offset (spec 020). */
export function createEvent(api: Api, venue: Location, e: EventSetup): Promise<Event> {
  return api.call<Event>('POST', '/events', {
    name: e.name,
    locationId: venue.id,
    startsAt: zoned(e.startsAt, venue.timeZone),
    endsAt: zoned(e.endsAt, venue.timeZone),
    basePrice: e.basePrice ?? '25.00',
    ...(e.capacity !== undefined ? { totalTicketCapacity: e.capacity } : {}),
    ...(e.maxTicketsPerCustomer !== undefined
      ? { maxTicketsPerCustomer: e.maxTicketsPerCustomer }
      : {}),
  } satisfies Schemas['EventInput']);
}

/** A tier; `quantity` only for an event without reserved seating (spec 007). */
export function addTier(
  api: Api,
  event: Event,
  tier: { name: string; price: string; quantity?: number },
): Promise<TicketTier> {
  return api.call<TicketTier>(
    'POST',
    `/events/${event.id}/tiers`,
    tier satisfies Schemas['TicketTierInput'],
  );
}

/** Turns reserved seating on and maps sections to tiers (spec 007). */
export function setSeating(
  api: Api,
  event: Event,
  sections: { sectionId: string; tierId: string }[],
): Promise<unknown> {
  return api.call('PUT', `/events/${event.id}/seating`, {
    reservedSeating: true,
    sections,
  } satisfies Schemas['SeatingInput']);
}

/** Spec 016: the per-customer limit. */
export function setTicketLimit(api: Api, event: Event, limit: number): Promise<Event> {
  return api.call<Event>('PATCH', `/events/${event.id}`, {
    maxTicketsPerCustomer: limit,
  } satisfies Schemas['EventUpdate']);
}

/** A customer's order, for set-up only (a scenario that walks the purchase does it in the UI). */
export function buyTickets(
  api: Api,
  event: Event,
  order: { quantity: number; holderName: string; tierId?: string },
): Promise<Order> {
  return api.call<Order>(
    'POST',
    `/events/${event.id}/orders`,
    order satisfies Schemas['OrderInput'],
  );
}

/** Research R6's name for `Api.as`. */
export const apiAs = (page: Page, signInFn: () => Promise<void>): Promise<Api> =>
  Api.as(page, signInFn);
