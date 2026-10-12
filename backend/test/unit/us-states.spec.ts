import { ERROR_CODES, US_STATES } from '@queuepass/shared';
import { contract } from '../contract/expect-to-match-contract';

/**
 * Spec 013 research R8: the Backend DTO and the Admin app's state list come from `US_STATES`,
 * so it must equal the contract's `UsState` enum. And every error code the contract declares must
 * be known to the exception filter, or it rewrites the envelope (data-model.md).
 */
describe('shared lists match the contract', () => {
  it('US_STATES equals the contract UsState enum', () => {
    const contractCodes = new Set<string>(contract.components.schemas.UsState.enum);
    const sharedCodes = new Set<string>(US_STATES.map((s) => s.code));
    expect([...sharedCodes].sort()).toEqual([...contractCodes].sort());
  });

  it('ERROR_CODES has every code of the contract ErrorEnvelope', () => {
    const contractCodes: string[] =
      contract.components.schemas.ErrorEnvelope.properties.error.properties.code.enum;
    const missing = contractCodes.filter((c) => !(ERROR_CODES as readonly string[]).includes(c));
    expect(missing).toEqual([]);
  });
});
