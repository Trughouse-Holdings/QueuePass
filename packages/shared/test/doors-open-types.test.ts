import { describe, expectTypeOf, it } from 'vitest';
import type { ApiComponents, Event, OrderEvent } from '../src';

/**
 * Review S2 (spec 025, contract 1.17.1): the hand-written types mirror the contract, which makes
 * `doorsOpenAt` and `entryOpensAt` required. Checked by `tsc -p packages/shared` (type-level).
 */
type Schemas = ApiComponents['schemas'];

describe('doors-open fields are required, as in contract 1.17.1', () => {
  it('Event.doorsOpenAt and Event.entryOpensAt', () => {
    expectTypeOf<Event['doorsOpenAt']>().toEqualTypeOf<string>();
    expectTypeOf<Event['entryOpensAt']>().toEqualTypeOf<string>();
    expectTypeOf<Schemas['Event']['doorsOpenAt']>().toEqualTypeOf<string>();
  });

  it('OrderEvent.doorsOpenAt', () => {
    expectTypeOf<OrderEvent['doorsOpenAt']>().toEqualTypeOf<string>();
    expectTypeOf<Schemas['OrderEvent']['doorsOpenAt']>().toEqualTypeOf<string>();
  });
});
