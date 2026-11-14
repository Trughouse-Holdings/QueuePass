import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LAYOUT_LIMITS } from '@queuepass/shared';
import { LayoutLinesInputDto, LayoutUpdateDto } from '../../src/layouts/dto/layout-input.dto';

/**
 * Spec 038 (T015; T060 review, M2): the layout requests' level limit. A new layout has at most
 * `maxLevels` levels; an update may keep as many as a carried-over layout has, up to
 * `maxCarriedLevels` (research R6). Each refusal names the limit that applies to it.
 */
const levels = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `Level ${i + 1}`, color: 'blue' }));
const sections = [{ name: 'A', rows: 1, seatsPerRow: 1, level: 'Level 1' }];

async function levelMessages(dto: object): Promise<string[]> {
  const errors = await validate(dto);
  return errors
    .filter((e) => e.property === 'levels')
    .flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('a layout’s level limit (M2)', () => {
  it(`refuses more than ${LAYOUT_LIMITS.maxLevels} levels for a new layout, naming that limit`, async () => {
    const dto = plainToInstance(LayoutLinesInputDto, {
      name: 'Club',
      levels: levels(LAYOUT_LIMITS.maxLevels + 1),
      sections,
    });
    expect(await levelMessages(dto)).toEqual([
      `a layout has at most ${LAYOUT_LIMITS.maxLevels} levels`,
    ]);
    const ok = plainToInstance(LayoutLinesInputDto, {
      name: 'Club',
      levels: levels(LAYOUT_LIMITS.maxLevels),
      sections,
    });
    expect(await levelMessages(ok)).toEqual([]);
  });

  it(`refuses more than ${LAYOUT_LIMITS.maxCarriedLevels} levels for an update, naming that limit`, async () => {
    const dto = plainToInstance(LayoutUpdateDto, {
      levels: levels(LAYOUT_LIMITS.maxCarriedLevels + 1),
      sections,
    });
    expect(await levelMessages(dto)).toEqual([
      `a layout has at most ${LAYOUT_LIMITS.maxCarriedLevels} levels`,
    ]);
    const ok = plainToInstance(LayoutUpdateDto, {
      levels: levels(LAYOUT_LIMITS.maxCarriedLevels),
      sections,
    });
    expect(await levelMessages(ok)).toEqual([]);
  });
});
