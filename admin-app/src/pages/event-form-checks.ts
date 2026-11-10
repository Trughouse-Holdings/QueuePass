/**
 * Spec 035: preview checks, live seat totals, and placement of field errors for the Admin
 * event form (research R3–R7, R9). The Backend remains authoritative (Constitution IV).
 */
import {
  BASE_PRICE_PATTERN,
  doorsOpenProblem,
  doorsOpenRangeMessage,
  formatLocalTime,
  resolveLocal,
  skippedTimeMessage,
  type Moment,
  type ResolvedLocal,
  type UsTimeZone,
} from '@queuepass/shared';
import { ApiError } from '../api/client';

export type Occurrence = '' | 'first' | 'second';
export type TimeField = 'startsAt' | 'endsAt' | 'doorsOpenAt';

export type FieldKey =
  | 'name'
  | 'locationId'
  | TimeField
  | 'reservedSeating'
  | 'totalTicketCapacity'
  | 'maxTicketsPerCustomer'
  | 'tiers'
  | `tiers.${number}.name`
  | `tiers.${number}.price`
  | `tiers.${number}.quantity`
  | `tiers.${number}.sectionIds`;

export interface TicketTypeDraft {
  name: string;
  price: string;
  quantity: string;
}

export interface LayoutSection {
  id: string;
  name: string;
  rows: number;
  seatsPerRow: number;
}

export interface PreviewInput {
  name: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
  doorsOpenAt: string;
  venueZone: UsTimeZone;
  hasVenue: boolean;
  occurrence: Record<TimeField, Occurrence>;
  typesLoaded: boolean;
  types: TicketTypeDraft[];
  reserved: boolean;
  totalTicketCapacity: string;
  venueCapacity: number | null;
  layoutSeats: number | null;
  maxPerCustomer: string;
  sectionType?: Record<string, string>;
  sections?: LayoutSection[];
  /**
   * Spec 036 FR-006, FR-010: doors are derived from the start ("Before the start" with a length).
   * Then a start that names no moment is the start's problem only, not a doors one.
   */
  doorsFromStart?: boolean;
}

export const MSG = {
  name: "Enter the event's name.",
  venue: "Choose a venue first: times are in the venue's local time.",
  doors: 'Enter when doors open.',
  starts: 'Enter when the event starts.',
  ends: 'Enter when the event ends.',
  endOrder: 'endsAt must be later than startsAt',
  typeName: 'Give this ticket type a name.',
  typePrice: 'Give this ticket type a price.',
  typeQuantity: 'Give this ticket type a quantity.',
  badPrice: 'price must be a non-negative decimal string with at most 2 decimal places',
  badQuantity: 'quantity must be a positive whole number',
} as const;

export const repeatedTypeNameMessage = (
  laterIndex: number,
  laterName: string,
  earlierIndex: number,
  earlierName: string,
): string =>
  `Ticket type ${laterIndex + 1}, '${laterName}', has the same name as ticket type ${earlierIndex + 1}, ` +
  `'${earlierName}'. Give each ticket type its own name.`;

export const overCapacityMessage = (eventName: string, capacity: number, total: number): string => {
  const who = eventName.trim() || 'This event';
  return `${who} has ${capacity} tickets, but its ticket types add up to ${total}.`;
};

/** Spec 016 research R7: the allowed range, or no upper bound while the capacity is unknown. */
export const limitMessage = (most: number | null): string =>
  most !== null
    ? `Tickets per customer must be a whole number from 1 to ${most}, or blank for no limit.`
    : 'Tickets per customer must be a whole number of at least 1, or blank for no limit.';

export function resolveField(local: string, zone: UsTimeZone): ResolvedLocal | null {
  try {
    return local ? resolveLocal(local, zone) : null;
  } catch {
    return null;
  }
}

export function momentOf(resolved: ResolvedLocal, occurrence: Occurrence): Moment | null {
  if (resolved.kind === 'ok') return resolved.moment;
  if (resolved.kind === 'repeated' && occurrence) return resolved[occurrence];
  return null;
}

const seatsOf = (s: LayoutSection): number => s.rows * s.seatsPerRow;

const parsedQuantity = (raw: string): number | null => {
  const t = raw.trim();
  if (!t || !/^[1-9]\d*$/.test(t)) return null;
  return Number(t);
};

/** The capacity the live total and the tickets-per-customer range compare against. */
export function capacityOf(
  input: Pick<PreviewInput, 'reserved' | 'layoutSeats' | 'totalTicketCapacity' | 'venueCapacity'>,
): number | null {
  if (input.reserved && input.layoutSeats != null) return input.layoutSeats;
  const typed = input.totalTicketCapacity.trim();
  if (typed !== '' && /^[1-9]\d*$/.test(typed)) return Number(typed);
  return input.venueCapacity;
}

export interface SeatTotals {
  assigned: number;
  total: number | null;
  leftover: number;
  over: number;
  summary: string;
  leftoverSentence: string | null;
  perType: { index: number; name: string; seats: number }[];
}

/**
 * Spec 035 FR-008, FR-009 (research R6): how many seats are assigned, what is left, and (for
 * general admission) whether the types are over the event's capacity.
 */
export function seatTotals(input: {
  reserved: boolean;
  types: TicketTypeDraft[];
  sections?: LayoutSection[];
  sectionType?: Record<string, string>;
  totalTicketCapacity: string;
  venueCapacity: number | null;
  layoutSeats: number | null;
}): SeatTotals {
  const perType = input.types.map((t, index) => {
    const name = t.name.trim() || `Ticket type ${index + 1}`;
    if (input.reserved) {
      const seats = (input.sections ?? [])
        .filter((sec) => (input.sectionType ?? {})[sec.id] === String(index))
        .reduce((n, sec) => n + seatsOf(sec), 0);
      return { index, name, seats };
    }
    return { index, name, seats: parsedQuantity(t.quantity) ?? 0 };
  });
  const assigned = perType.reduce((n, t) => n + t.seats, 0);
  const total = capacityOf(input);
  const leftover = total == null ? 0 : Math.max(0, total - assigned);
  const over = total == null ? 0 : Math.max(0, assigned - total);
  const summary =
    total == null
      ? `${assigned.toLocaleString()} ${assigned === 1 ? 'seat' : 'seats'} assigned`
      : `${assigned.toLocaleString()} of ${total.toLocaleString()} seats assigned`;
  let leftoverSentence: string | null = null;
  if (total != null && over > 0) {
    leftoverSentence = `${over.toLocaleString()} ${over === 1 ? 'seat' : 'seats'} over the event's capacity`;
  } else if (total != null && leftover === 0 && assigned === total) {
    leftoverSentence = `All ${total.toLocaleString()} seats are assigned.`;
  } else if (total != null && leftover > 0) {
    leftoverSentence = `${leftover.toLocaleString()} ${leftover === 1 ? 'seat' : 'seats'} not assigned to a ticket type`;
  }
  return { assigned, total, leftover, over, summary, leftoverSentence, perType };
}

/**
 * Every problem the form can see right now (research R3). The form shows a key once it has been
 * left or after submit (research R5).
 */
export function previewErrors(input: PreviewInput): Map<string, string> {
  const errors = new Map<string, string>();
  if (!input.name.trim()) errors.set('name', MSG.name);
  if (!input.locationId) errors.set('locationId', MSG.venue);

  if (input.hasVenue) {
    const sent: Record<TimeField, string> = {
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      doorsOpenAt: input.doorsOpenAt,
    };
    const instants: Partial<Record<TimeField, Date>> = {};
    for (const field of ['doorsOpenAt', 'startsAt', 'endsAt'] as const) {
      if (!sent[field]) {
        errors.set(
          field,
          field === 'doorsOpenAt' ? MSG.doors : field === 'startsAt' ? MSG.starts : MSG.ends,
        );
        continue;
      }
      const r = resolveField(sent[field], input.venueZone);
      if (!r) {
        errors.set(
          field,
          field === 'doorsOpenAt' ? MSG.doors : field === 'startsAt' ? MSG.starts : MSG.ends,
        );
        continue;
      }
      if (r.kind === 'skipped') {
        errors.set(
          field,
          skippedTimeMessage(sent[field], input.venueZone, r.skippedFrom, r.skippedTo),
        );
        continue;
      }
      const m = momentOf(r, input.occurrence[field]);
      if (!m) {
        errors.set(field, `Choose which ${formatLocalTime(sent[field])} you mean.`);
        continue;
      }
      instants[field] = m.instant;
    }
    if (
      instants.startsAt &&
      instants.endsAt &&
      instants.endsAt.getTime() <= instants.startsAt.getTime()
    ) {
      errors.set('endsAt', MSG.endOrder);
    }
    if (
      instants.startsAt &&
      instants.doorsOpenAt &&
      doorsOpenProblem(instants.startsAt, instants.doorsOpenAt)
    ) {
      errors.set('doorsOpenAt', doorsOpenRangeMessage(instants.startsAt, input.venueZone));
    }
    if (input.doorsFromStart && !instants.startsAt) errors.delete('doorsOpenAt');
  }

  if (input.typesLoaded) {
    const seen = new Map<string, { index: number; name: string }>();
    for (const [i, t] of input.types.entries()) {
      if (!t.name.trim()) errors.set(`tiers.${i}.name`, MSG.typeName);
      else {
        const key = t.name.trim().toLowerCase();
        const earlier = seen.get(key);
        if (earlier && !errors.has(`tiers.${i}.name`)) {
          errors.set(
            `tiers.${i}.name`,
            repeatedTypeNameMessage(i, t.name.trim(), earlier.index, earlier.name),
          );
        } else {
          seen.set(key, { index: i, name: t.name.trim() });
        }
      }
      if (!t.price.trim()) errors.set(`tiers.${i}.price`, MSG.typePrice);
      else if (!BASE_PRICE_PATTERN.test(t.price.trim())) {
        errors.set(`tiers.${i}.price`, MSG.badPrice);
      }
      if (!input.reserved) {
        if (!t.quantity.trim()) errors.set(`tiers.${i}.quantity`, MSG.typeQuantity);
        else if (parsedQuantity(t.quantity) == null) {
          errors.set(`tiers.${i}.quantity`, MSG.badQuantity);
        }
      }
    }

    if (!input.reserved) {
      const totals = seatTotals(input);
      if (totals.over > 0 && totals.total != null) {
        errors.set('tiers', overCapacityMessage(input.name, totals.total, totals.assigned));
      }
    }
  }

  const most = capacityOf(input);
  const limit = input.maxPerCustomer.trim();
  if (
    limit !== '' &&
    (!Number.isInteger(Number(limit)) ||
      Number(limit) < 1 ||
      (most !== null && Number(limit) > most))
  ) {
    errors.set('maxTicketsPerCustomer', limitMessage(most));
  }

  return errors;
}

export function fieldOrder(typeCount: number): string[] {
  const keys = ['name', 'locationId', 'doorsOpenAt', 'startsAt', 'endsAt'];
  for (let i = 0; i < typeCount; i += 1) {
    keys.push(
      `tiers.${i}.name`,
      `tiers.${i}.price`,
      `tiers.${i}.quantity`,
      `tiers.${i}.sectionIds`,
    );
  }
  keys.push('reservedSeating', 'tiers', 'totalTicketCapacity', 'maxTicketsPerCustomer');
  return keys;
}

export function firstErrorKey(errors: Map<string, string>, typeCount: number): string | null {
  for (const key of fieldOrder(typeCount)) {
    if (errors.has(key)) return key;
  }
  for (const key of errors.keys()) return key;
  return null;
}

/** The first placed server-refusal key, in the same order as preview errors. */
export function firstPlacedKey(placed: PlacedErrors, typeCount: number): string | null {
  const keys = new Map<string, string>();
  for (const [path, messages] of placed.fields) {
    if (messages[0]) keys.set(path, messages[0]);
  }
  for (const [i, errs] of placed.types) {
    for (const e of errs) keys.set(`tiers.${i}.${e.field}`, e.message);
  }
  if (placed.tiers[0]) keys.set('tiers', placed.tiers[0]);
  if (placed.seating[0]) keys.set('reservedSeating', placed.seating[0]);
  return firstErrorKey(keys, typeCount);
}

/** Focus target: a form control id (or the ticket-type ids the form assigns). */
export function focusIdFor(key: string): string {
  const type = /^tiers\.(\d+)\.(name|price|quantity|sectionIds)$/.exec(key);
  if (type) {
    if (type[2] === 'sectionIds') return `seats-${Number(type[1]) + 1}`;
    return `type-${Number(type[1]) + 1}-${type[2]}`;
  }
  if (key === 'reservedSeating' || key === 'tiers') return 'tickets-and-seating';
  return key;
}

/** One refusal message placed on a ticket type, with the field it names (spec 031 research R3). */
export interface TypeFieldError {
  field: string;
  message: string;
}

/** Spec 031 FR-010 and 035 FR-010: a refusal's messages by the place in the form they name. */
export interface PlacedErrors {
  types: Map<number, TypeFieldError[]>;
  tiers: string[];
  seating: string[];
  /** Event-detail fields (`name`, times, `maxTicketsPerCustomer`, …). */
  fields: Map<string, string[]>;
  /** Messages that name no field, shown next to submit. */
  unmapped: string[];
}

export const TYPE_FIELDS = ['name', 'price', 'quantity', 'sectionIds'];

/**
 * Spec 031 (research R3, R5) and 035 FR-010: reads the path a refusal names, from
 * `details.field` (exactly the path) or from the start of each `details.fields` entry.
 * Unmapped messages stay next to submit, not in a banner at the top.
 */
export function fieldErrors(error: ApiError | null): PlacedErrors {
  const placed: PlacedErrors = {
    types: new Map(),
    tiers: [],
    seating: [],
    fields: new Map(),
    unmapped: [],
  };
  if (!error) return placed;
  const addField = (path: string, message: string) => {
    placed.fields.set(path, [...(placed.fields.get(path) ?? []), message]);
  };
  const place = (path: string, message: string, exact: boolean) => {
    const type = /^tiers\.(\d+)\.(\w+)/.exec(path);
    if (type) {
      const i = Number(type[1]);
      placed.types.set(i, [...(placed.types.get(i) ?? []), { field: type[2]!, message }]);
      return;
    }
    if (exact ? path === 'tiers' : /^tiers[ .]/.test(path)) {
      placed.tiers.push(message);
      return;
    }
    const head = exact ? path : path.split(' ')[0]!;
    if (/^(reservedSeating|totalTicketCapacity)$/.test(head)) {
      placed.seating.push(message);
      return;
    }
    if (/^(name|locationId|startsAt|endsAt|doorsOpenAt|maxTicketsPerCustomer)$/.test(head)) {
      addField(head, message);
      return;
    }
    placed.unmapped.push(message);
  };
  const field = error.details?.field;
  if (typeof field === 'string') place(field, error.envelope.error.message, true);
  const fields = error.details?.fields;
  if (Array.isArray(fields)) {
    for (const entry of fields) if (typeof entry === 'string') place(entry, entry, false);
  }
  if (typeof field !== 'string' && !Array.isArray(fields)) {
    if (error.code === 'DOORS_OPEN_OUT_OF_RANGE') {
      addField('doorsOpenAt', error.envelope.error.message);
    } else if (error.envelope.error.message) {
      placed.unmapped.push(error.envelope.error.message);
    }
  }
  return placed;
}

export interface SoldCounts {
  eventSold: number;
  soldByTier: Map<string, number>;
  soldBySection: Map<string, number>;
}

export const lockReason = {
  seating: "Can't be changed: tickets have been sold.",
  section: "Can't be changed: this section has sold tickets.",
  type: "Can't be removed: tickets have been sold.",
  quantity: (sold: number) =>
    `This type has ${sold.toLocaleString()} ${sold === 1 ? 'ticket' : 'tickets'} already sold.`,
} as const;

export function visibleErrors(
  all: Map<string, string>,
  touched: ReadonlySet<string>,
  submitted: boolean,
): Map<string, string> {
  if (submitted) return new Map(all);
  const shown = new Map<string, string>();
  for (const [key, message] of all) {
    if (touched.has(key)) shown.set(key, message);
  }
  return shown;
}
