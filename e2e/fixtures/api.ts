// Spec 022 (research R6, FR-004): data a scenario does not itself walk is set up through the
// Backend's API, with the access token the app itself sent after a real sign-in on Keycloak's
// page. No other credential, no direct-grant client, no bypass. Request shapes are the contract's
// (contracts/openapi.yaml), through the generated types.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  expect,
  request,
  type APIRequestContext,
  type Browser,
  type Page,
  type Request,
} from '@playwright/test';
import type { components } from '../../packages/shared/src/api-schema';
import { API_BASE, type AppName } from './apps';
import { signIn } from './sign-in';
import { zoned } from './time';

type Schemas = components['schemas'];
export type Location = Schemas['Location'];
export type Event = Schemas['Event'];
export type LayoutDetail = Schemas['LayoutDetail'];
export type LayoutFile = Schemas['LayoutFile'];
export type LayoutSectionSeats = Schemas['LayoutSectionSeats'];
export type SeatChoice = Schemas['SeatChoice'];
export type OffSaleSelector = Schemas['OffSaleSelector'];
export type Reservation = Schemas['Reservation'];
export type TicketTier = Schemas['TicketTier'];
export type Order = Schemas['Order'];
/** A venue's address as the Admin form takes it (spec 013): all four fields. */
export type Place = Required<Pick<Schemas['LocationInput'], 'street' | 'city' | 'state' | 'zip'>>;

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
    // If sign-in itself fails, `first` is never awaited; its rejection is not an extra error.
    first.catch(() => undefined);
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
    next.catch(() => undefined);
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

  /**
   * Spec 026 (research R11): one call whose refusal is the point, so its status and `Retry-After`
   * are returned and nothing is asserted. No reload on a 401: the test that sends it has just
   * signed in.
   */
  async attempt(
    method: 'POST',
    path: string,
    data?: unknown,
  ): Promise<{ status: number; retryAfter: number | null }> {
    const res = await this.ctx.fetch(path, { method, data });
    const header = res.headers()['retry-after'];
    return { status: res.status(), retryAfter: header === undefined ? null : Number(header) };
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

/** A venue at one of the stand-in's addresses (research R4), with no layout. */
export async function createVenue(api: Api, place: Place, name: string): Promise<Location> {
  const venue = await api.call<Location>('POST', '/locations', {
    name,
    ...place,
    seatingCapacity: 500,
  } satisfies Schemas['LocationInput']);
  expect(venue.addressVerified, `${name}: the stand-in should verify ${place.street}`).toBe(true);
  return venue;
}

/** Spec 038 (FR-005): a layout of the venue from section lines; rows and seats numbered 1, 2, …. */
export function createLayout(
  api: Api,
  venue: Location,
  lines: Schemas['LayoutLinesInput'],
): Promise<LayoutDetail> {
  return api.call<LayoutDetail>('POST', `/locations/${venue.id}/layouts`, lines);
}

/** Spec 038 (FR-004): a layout file imported at the venue, under `name` when given. */
export function importLayout(
  api: Api,
  venue: Location,
  file: LayoutFile,
  name?: string,
): Promise<LayoutDetail> {
  return api.call<LayoutDetail>('POST', `/locations/${venue.id}/layouts/import`, {
    file,
    ...(name !== undefined ? { name } : {}),
  } satisfies Schemas['LayoutImport']);
}

/** The demo's KFC Yum! Center layout files (spec 038 research R18), as the reset imports them. */
export type YumCenterLayout = 'basketball' | 'end-stage' | 'center-stage' | 'wrestling';
export function yumCenterFile(which: YumCenterLayout): LayoutFile {
  const path = join(__dirname, '../../backend/src/scripts/layouts', `yum-center-${which}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as LayoutFile;
}

/** A section of the layout by its name. */
export function sectionOf(layout: LayoutDetail, name: string): LayoutDetail['sections'][number] {
  const section = layout.sections.find((s) => s.name === name);
  expect(section, `${layout.name} has a section ${name}`).toBeDefined();
  return section!;
}

/** A level of the layout by its name. */
export function levelOf(layout: LayoutDetail, name: string): LayoutDetail['levels'][number] {
  const level = layout.levels.find((l) => l.name === name);
  expect(level, `${layout.name} has a level ${name}`).toBeDefined();
  return level!;
}

/**
 * Spec 038 (research R2): a seat as the API takes it, by numbers, from its section's name and the
 * row and seat labels people read ("115", "F", "7").
 */
export async function seatAt(
  api: Api,
  layout: LayoutDetail,
  section: string,
  row: string,
  seat: string,
): Promise<SeatChoice> {
  const { id: sectionId } = sectionOf(layout, section);
  const seats = await api.call<LayoutSectionSeats>(
    'GET',
    `/layouts/${layout.id}/sections/${sectionId}`,
  );
  const r = seats.rows.find((x) => x.label === row);
  const s = r?.seats.find((x) => x.label === seat);
  expect(s, `${layout.name} has section ${section}, row ${row}, seat ${seat}`).toBeDefined();
  return { sectionId, row: r!.number, seat: s!.number };
}

export interface EventSetup {
  name: string;
  startsAt: Date;
  endsAt: Date;
  capacity?: number;
  basePrice?: string;
  maxTicketsPerCustomer?: number;
  /** Spec 025: when doors open; left out, the Backend takes the start minus 1 hour. */
  doorsOpenAt?: Date;
  /** Spec 038: reserved seating on one of the venue's layouts, priced by level. */
  seating?: {
    layout: LayoutDetail;
    /** A price for each level with seats on sale, by the level's name. */
    prices: Record<string, string>;
    offSale?: OffSaleSelector[];
  };
}

/** An event at the venue, its times sent in the venue's zone with its offset (spec 020). */
export function createEvent(api: Api, venue: Location, e: EventSetup): Promise<Event> {
  return api.call<Event>('POST', '/events', {
    name: e.name,
    locationId: venue.id,
    startsAt: zoned(e.startsAt, venue.timeZone),
    endsAt: zoned(e.endsAt, venue.timeZone),
    ...(e.doorsOpenAt ? { doorsOpenAt: zoned(e.doorsOpenAt, venue.timeZone) } : {}),
    basePrice: e.basePrice ?? '25.00',
    ...(e.capacity !== undefined ? { totalTicketCapacity: e.capacity } : {}),
    ...(e.maxTicketsPerCustomer !== undefined
      ? { maxTicketsPerCustomer: e.maxTicketsPerCustomer }
      : {}),
    ...(e.seating
      ? {
          layoutId: e.seating.layout.id,
          levelPrices: Object.entries(e.seating.prices).map(([name, price]) => ({
            levelId: levelOf(e.seating!.layout, name).id,
            price,
          })),
          offSale: e.seating.offSale ?? [],
        }
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
  order: { quantity: number; holderName: string; tierId?: string; seats?: SeatChoice[] },
): Promise<Order> {
  return api.call<Order>(
    'POST',
    `/events/${event.id}/orders`,
    order satisfies Schemas['OrderInput'],
  );
}

/** Spec 033, 038: a customer's hold of seats, for set-up (one seat a request, as the app does). */
export async function holdSeats(api: Api, event: Event, seats: SeatChoice[]): Promise<Reservation> {
  let held: Reservation | undefined;
  for (const seat of seats) {
    held = await api.call<Reservation>('POST', `/events/${event.id}/reservation`, {
      seats: [seat],
    } satisfies Schemas['ReservationInput']);
  }
  return held!;
}

/** Research R6's name for `Api.as`. */
export const apiAs = (page: Page, signInFn: () => Promise<void>): Promise<Api> =>
  Api.as(page, signInFn);

/**
 * A signed-in user's API in a context of its own (an admin setting up, or a customer buying for
 * set-up), so the test's own pages keep their own sessions. Close it when done.
 */
export async function apiFor(
  browser: Browser,
  app: AppName,
  username: string,
): Promise<{ api: Api; page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const api = await apiAs(page, () => signIn(page, app, username));
  return {
    api,
    page,
    close: async () => {
      await api.dispose();
      await context.close();
    },
  };
}

/**
 * A seated event (spec 038): a venue with one layout from section lines, and an event there on it,
 * priced by level (`prices`, by level name), with the seats `offSale` gives off sale.
 */
export async function seatedEvent(
  api: Api,
  setup: {
    venueName: string;
    place: Place;
    layout: Schemas['LayoutLinesInput'];
    event: EventSetup;
    prices: Record<string, string>;
    offSale?: (layout: LayoutDetail) => OffSaleSelector[];
  },
): Promise<{ venue: Location; event: Event; layout: LayoutDetail }> {
  const venue = await createVenue(api, setup.place, setup.venueName);
  const layout = await createLayout(api, venue, setup.layout);
  const event = await createEvent(api, venue, {
    ...setup.event,
    seating: { layout, prices: setup.prices, offSale: setup.offSale?.(layout) },
  });
  return { venue, event, layout };
}

/**
 * Spec 038 (research R18): a venue of the test's own with the Yum! Center's Basketball layout,
 * and an event on it priced as the demo's women's game (Courtside $95, Lower sideline $60, Lower
 * end $35) with the upper level, sections 301–330, off sale; `offSale` adds more.
 */
export async function basketballEvent(
  api: Api,
  setup: { venueName: string; place: Place; event: EventSetup; offSale?: OffSaleSelector[] },
): Promise<{ venue: Location; event: Event; layout: LayoutDetail }> {
  const venue = await createVenue(api, setup.place, setup.venueName);
  const layout = await importLayout(api, venue, yumCenterFile('basketball'));
  const upper = layout.sections
    .filter((s) => /^3\d\d$/.test(s.name))
    .map((s) => ({ sectionId: s.id }));
  const event = await createEvent(api, venue, {
    ...setup.event,
    seating: {
      layout,
      prices: WOMENS_GAME_PRICES,
      offSale: [...upper, ...(setup.offSale ?? [])],
    },
  });
  return { venue, event, layout };
}

/** The demo's women's game prices by level (research R18); Upper is off sale. */
export const WOMENS_GAME_PRICES = {
  Courtside: '95.00',
  'Lower sideline': '60.00',
  'Lower end': '35.00',
};
