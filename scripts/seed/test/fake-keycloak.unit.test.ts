import { describe, expect, it } from 'vitest';
import { createFakeKeycloak } from './fake-keycloak';

/**
 * Spec 010 research R4: the fake names any admin client method it does not implement, so a seed
 * change that calls a new one says what to add (as spec 021's `realms.findOne` and
 * `realms.update` did).
 */
describe('the fake Keycloak admin client', () => {
  it('names a method it does not implement, and records the call', async () => {
    const fake = createFakeKeycloak();

    await expect(fake.kc.realms.del({ realm: 'queuepass' })).rejects.toThrow(
      'fake Keycloak: realms.del is not implemented',
    );
    await expect(fake.kc.groups.find()).rejects.toThrow(
      'fake Keycloak: groups.find is not implemented',
    );
    expect(fake.methods()).toEqual(['realms.del', 'groups.find']);
  });

  it('refuses a request for another realm than its own', async () => {
    const fake = createFakeKeycloak();

    await expect(fake.kc.roles.find({ realm: 'master' })).rejects.toThrow(
      "fake Keycloak: roles.find asked for realm 'master', not 'queuepass'",
    );
    await expect(
      createFakeKeycloak(undefined, { realm: 'other' }).kc.roles.find({ realm: 'other' }),
    ).resolves.toEqual([]);
  });

  it('is not a thenable, so it can be returned from an async function', async () => {
    const fake = createFakeKeycloak();

    const resolved = await (async () => fake.kc)();

    expect(resolved).toBe(fake.kc);
  });

  it('finds one realm by name, or nothing, and updates only the fields sent', async () => {
    const fake = createFakeKeycloak();
    await fake.kc.realms.create({ realm: 'queuepass', displayName: 'QueuePass' });

    await expect(fake.kc.realms.findOne({ realm: 'queuepass' })).resolves.toEqual({
      realm: 'queuepass',
      displayName: 'QueuePass',
    });
    await fake.kc.realms.update({ realm: 'queuepass' }, { loginTheme: 'queuepass' });

    expect(fake.state.realms).toEqual([
      { realm: 'queuepass', displayName: 'QueuePass', loginTheme: 'queuepass' },
    ]);
    const other = createFakeKeycloak(undefined, { realm: 'other' });
    await expect(other.kc.realms.findOne({ realm: 'other' })).resolves.toBeUndefined();
    await expect(other.kc.realms.update({ realm: 'other' }, {})).rejects.toThrow(
      "fake Keycloak: no realm 'other'",
    );
  });

  it('hands out copies, never its own state', async () => {
    const fake = createFakeKeycloak();
    await fake.kc.realms.create({ realm: 'queuepass' });

    const [realm] = await fake.kc.realms.find();
    realm.realm = 'changed';

    expect(fake.state.realms).toEqual([{ realm: 'queuepass' }]);
  });
});
