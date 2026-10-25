import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { TimeZoneSource } from '@prisma/client';
import { US_TIME_ZONES } from '@queuepass/shared';
import { contract } from '../contract/expect-to-match-contract';

/**
 * Spec 020 research R2 (data-model.md): the zone list lives in three places, the contract's
 * `UsTimeZone`, the shared `US_TIME_ZONES`, and the `location_time_zone_known` CHECK of the
 * `venue_time_zones` migration. They must be equal, in order, as `013` does for `UsState`. And the
 * contract's `TimeZoneSource` must equal the Prisma enum.
 */
const MIGRATIONS = path.resolve(__dirname, '../../prisma/migrations');

function checkListFromMigration(): string[] {
  const dir = readdirSync(MIGRATIONS).find((d) => d.endsWith('_venue_time_zones'));
  if (!dir) throw new Error('No *_venue_time_zones migration');
  const sql = readFileSync(path.join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
  const check = /"location_time_zone_known"\s+CHECK\s*\(\s*"timeZone"\s+IN\s*\(([^)]*)\)/i.exec(
    sql,
  );
  if (!check) throw new Error('No location_time_zone_known CHECK in the migration');
  return [...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('the three time zone lists agree (R2)', () => {
  const contractZones: string[] = contract.components.schemas.UsTimeZone.enum;

  it('US_TIME_ZONES equals the contract UsTimeZone enum, in order', () => {
    expect(US_TIME_ZONES.map((z) => z.id)).toEqual(contractZones);
  });

  it("the migration's CHECK lists the same zones, in order", () => {
    expect(checkListFromMigration()).toEqual(contractZones);
  });

  it('the contract TimeZoneSource equals the Prisma enum', () => {
    expect(Object.values(TimeZoneSource)).toEqual(contract.components.schemas.TimeZoneSource.enum);
  });
});
