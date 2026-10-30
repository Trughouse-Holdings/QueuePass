import { describe, expect, it } from 'vitest';
import { createFakeKeycloak } from './fake-keycloak';

/**
 * Spec 010 research R4: the fake names any admin client method it does not implement, so a seed
 * change that calls a new one (spec 021's `realms.findOne`, `realms.update`) says what to add.
 */
describe('the fake Keycloak admin client', () => {
  it('names a method it does not implement, and records the call', async () => {
    const fake = createFakeKeycloak();

    await expect(fake.kc.realms.update({ realm: 'queuepass' }, {})).rejects.toThrow(
      'fake Keycloak: realms.update is not implemented',
    );
    await expect(fake.kc.groups.find()).rejects.toThrow(
      'fake Keycloak: groups.find is not implemented',
    );
    expect(fake.methods()).toEqual(['realms.update', 'groups.find']);
  });

  it('is not a thenable, so it can be returned from an async function', async () => {
    const fake = createFakeKeycloak();

    const resolved = await (async () => fake.kc)();

    expect(resolved).toBe(fake.kc);
  });

  it('hands out copies, never its own state', async () => {
    const fake = createFakeKeycloak();
    await fake.kc.realms.create({ realm: 'queuepass' });

    const [realm] = await fake.kc.realms.find();
    realm.realm = 'changed';

    expect(fake.state.realms).toEqual([{ realm: 'queuepass' }]);
  });
});
