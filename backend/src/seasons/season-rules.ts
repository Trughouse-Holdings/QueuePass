import { formatEventTime } from '@queuepass/shared';

/**
 * Spec 041 (research R4; FR-002 to FR-006, FR-009, FR-010): a Season's rules, pure, no Prisma. Each
 * problem is a message whose first word is the field path the contract names, so a 400
 * `VALIDATION_FAILED` carries them in `details.fields` and the Admin apps place each beside its
 * field: `eventIds.<i>` for an event, `prices.<i>` for a sent price entry (by index, since a ticket
 * type name may contain dots; review M5), `prices.<levelId>` for a level with no entry. Names match
 * ignoring case. The service gathers the facts under R2's locks and refuses with every problem.
 */

export type SportName = 'BASKETBALL' | 'FOOTBALL' | 'BASEBALL' | 'SOCCER' | 'HOCKEY' | 'VOLLEYBALL';

export interface SeasonRulePrice {
  levelId?: string;
  tierName?: string;
  price: string;
}

/** The Season as the request states it, times already resolved in the venue's zone (R16). */
export interface SeasonRuleInput {
  name: string;
  sport: SportName | null;
  team: string | null;
  locationId: string;
  layoutId: string | null;
  salesEndAt: Date;
  singleSalesOpenAt: Date | null;
  maxPassesPerCustomer: number | null;
  eventIds: string[];
  prices: SeasonRulePrice[];
}

/** One event as the rules read it. */
export interface SeasonRuleEvent {
  id: string;
  name: string;
  locationId: string;
  /** The event's layout; `null` for general admission. */
  layoutId: string | null;
  status: 'SCHEDULED' | 'CANCELLED';
  startsAt: Date;
  /** General admission: the names of the event's ticket types. */
  tierNames: string[];
}

export interface SeasonRuleLevel {
  id: string;
  name: string;
  rank: number;
}

export interface SeasonRuleContext {
  /** The events the request names that exist, by id. */
  events: Map<string, SeasonRuleEvent>;
  /**
   * Events already in this Season (an update): kept though cancelled or started since (spec edge
   * cases), as long as they are still at its venue on its layout.
   */
  alreadyIn: Set<string>;
  /** The layout's price levels (seated); empty for general admission. */
  levels: SeasonRuleLevel[];
  /** The database's clock (R16). */
  now: Date;
}

export const NAME_MAX = 100;
export const PASSES_MIN = 1;
export const PASSES_MAX = 10;
/** FR-010: a Season goes on sale with at least this many events not cancelled. */
export const MIN_EVENTS_TO_PUBLISH = 2;

const key = (name: string): string => name.trim().toLowerCase();

/** FR-002: the name, sport and team (both or neither), and passes per customer. */
export function fieldProblems(input: SeasonRuleInput): string[] {
  const problems: string[] = [];
  const name = input.name.trim();
  if (name.length < 1 || name.length > NAME_MAX) {
    problems.push(`name must be between 1 and ${NAME_MAX} characters`);
  }
  const team = input.team?.trim() ?? '';
  if (team.length > NAME_MAX) {
    problems.push(`team must be between 1 and ${NAME_MAX} characters`);
  } else if (input.sport !== null && team === '') {
    problems.push('team is required when a sport is chosen: set both or neither');
  } else if (input.sport === null && team !== '') {
    problems.push('sport is required when a team is given: set both or neither');
  }
  const most = input.maxPassesPerCustomer;
  if (most !== null && (!Number.isInteger(most) || most < PASSES_MIN || most > PASSES_MAX)) {
    problems.push(
      `maxPassesPerCustomer must be a whole number from ${PASSES_MIN} to ${PASSES_MAX}, or empty for no limit`,
    );
  }
  return problems;
}

/** The earliest event not cancelled, or `null`. */
export function earliestEvent(events: readonly SeasonRuleEvent[]): SeasonRuleEvent | null {
  let first: SeasonRuleEvent | null = null;
  for (const e of events) {
    if (e.status === 'CANCELLED') continue;
    if (!first || e.startsAt < first.startsAt) first = e;
  }
  return first;
}

/**
 * FR-006 at every save: single tickets go on sale no later than the sales end, and the sales end
 * is no later than the start of the earliest event not cancelled. Times are named in `zone`.
 */
export function timeProblems(
  input: SeasonRuleInput,
  events: readonly SeasonRuleEvent[],
  zone: string,
): string[] {
  const problems: string[] = [];
  if (input.singleSalesOpenAt && input.singleSalesOpenAt > input.salesEndAt) {
    problems.push(
      `singleSalesOpenAt must be no later than the sales end (${formatEventTime(input.salesEndAt, zone)})`,
    );
  }
  const first = earliestEvent(events);
  if (first && input.salesEndAt > first.startsAt) {
    problems.push(
      `salesEndAt must be no later than the start of the first event, ${first.name} ` +
        `(${formatEventTime(first.startsAt, zone)})`,
    );
  }
  return problems;
}

/**
 * FR-003, FR-004: each event at the Season's venue, on its layout (seated) or general admission;
 * a new one scheduled and not started (`startsAt` after `now`); no repeats.
 */
export function eventProblems(input: SeasonRuleInput, ctx: SeasonRuleContext): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, id] of input.eventIds.entries()) {
    const path = `eventIds.${i}`;
    const e = ctx.events.get(id);
    if (!e) {
      problems.push(`${path} names no event (${id})`);
      continue;
    }
    if (seen.has(id)) {
      problems.push(`${path} repeats ${e.name}; list each event once`);
      continue;
    }
    seen.add(id);
    if (e.locationId !== input.locationId) {
      problems.push(`${path} ${e.name} is at another venue`);
    } else if (input.layoutId === null && e.layoutId !== null) {
      problems.push(`${path} ${e.name} has reserved seating; this Season is general admission`);
    } else if (input.layoutId !== null && e.layoutId === null) {
      problems.push(`${path} ${e.name} is general admission; this Season sells seats on a layout`);
    } else if (e.layoutId !== input.layoutId) {
      problems.push(`${path} ${e.name} uses another layout`);
    } else if (!ctx.alreadyIn.has(id) && e.status === 'CANCELLED') {
      problems.push(`${path} ${e.name} is cancelled`);
    } else if (!ctx.alreadyIn.has(id) && e.startsAt <= ctx.now) {
      problems.push(`${path} ${e.name} has already started`);
    }
  }
  return problems;
}

/**
 * FR-009: each sent entry by index (seated: a level of the layout, once; general admission: a
 * name, once ignoring case, that every event not cancelled sells). With `complete` (publishing, or
 * a save of a Season on sale), every level priced (seated) or at least one name (general
 * admission).
 */
export function priceProblems(
  input: SeasonRuleInput,
  ctx: SeasonRuleContext,
  options: { complete: boolean },
): string[] {
  const problems: string[] = [];
  const seated = input.layoutId !== null;
  const levels = new Map(ctx.levels.map((l) => [l.id, l]));
  const priced = new Set<string>();
  const events = input.eventIds
    .map((id) => ctx.events.get(id))
    .filter((e): e is SeasonRuleEvent => e !== undefined && e.status !== 'CANCELLED');
  for (const [i, entry] of input.prices.entries()) {
    const path = `prices.${i}`;
    const hasLevel = entry.levelId !== undefined;
    const hasName = entry.tierName !== undefined;
    if (hasLevel === hasName) {
      problems.push(`${path} must name exactly one of a price level or a ticket type name`);
      continue;
    }
    if (seated) {
      if (!hasLevel) {
        problems.push(`${path} must name a price level of the layout, not a ticket type name`);
        continue;
      }
      const level = levels.get(entry.levelId!);
      if (!level) {
        problems.push(`${path} names a price level that is not on this Season's layout`);
      } else if (priced.has(level.id)) {
        problems.push(`${path} prices ${level.name} again; give each level one price`);
      } else {
        priced.add(level.id);
      }
      continue;
    }
    if (!hasName) {
      problems.push(
        `${path} must name a ticket type, not a price level: the Season is general admission`,
      );
      continue;
    }
    const name = entry.tierName!.trim();
    if (name.length < 1 || name.length > NAME_MAX) {
      problems.push(`${path} ticket type name must be between 1 and ${NAME_MAX} characters`);
      continue;
    }
    if (priced.has(key(name))) {
      problems.push(`${path} prices ${name} again; give each ticket type name one price`);
      continue;
    }
    priced.add(key(name));
    const lacking = events.find((e) => !e.tierNames.some((t) => key(t) === key(name)));
    if (lacking) {
      problems.push(`${path} ${lacking.name} has no ticket type named ${name}`);
    }
  }
  if (options.complete) {
    if (seated) {
      for (const level of [...ctx.levels].sort((a, b) => a.rank - b.rank)) {
        if (!priced.has(level.id)) problems.push(`prices.${level.id} Give ${level.name} a price.`);
      }
    } else if (priced.size === 0) {
      problems.push('prices must price at least one ticket type name');
    }
  }
  return problems;
}

/**
 * FR-010, the publish-only rules, with the prices complete: at least 2 events not cancelled, the
 * sales end in the future by the database's clock. The service also runs the rules every save
 * runs (fields, events, times).
 */
export function publishProblems(input: SeasonRuleInput, ctx: SeasonRuleContext): string[] {
  const problems: string[] = [];
  const live = input.eventIds.filter((id) => {
    const e = ctx.events.get(id);
    return e !== undefined && e.status !== 'CANCELLED';
  });
  if (new Set(live).size < MIN_EVENTS_TO_PUBLISH) {
    problems.push(
      `eventIds must hold at least ${MIN_EVENTS_TO_PUBLISH} events not cancelled to put the Season on sale`,
    );
  }
  if (input.salesEndAt <= ctx.now) {
    problems.push('salesEndAt must be in the future to put the Season on sale');
  }
  problems.push(...priceProblems(input, ctx, { complete: true }));
  return problems;
}
