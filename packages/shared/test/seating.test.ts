import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as shared from '../src/index';
import { LAYOUT_LIMITS, LEVEL_COLORS } from '../src/seating';

/**
 * Spec 038 research R5, R13 (T007): the 12 level colors are the contract's `LevelColor`, in its
 * order (the carry-over gives levels colors in this order, R16), and the layout limits are the
 * spec's (FR-001 to FR-003, FR-013).
 */
const contract = readFileSync(resolve(process.cwd(), '../../contracts/openapi.yaml'), 'utf8');

function contractEnum(schema: string): string[] {
  const match = new RegExp(`\\n {4}${schema}:\\n[\\s\\S]*?\\n {6}enum: \\[([^\\]]*)\\]`).exec(
    contract,
  );
  if (!match) throw new Error(`No ${schema} enum in the contract`);
  return match[1].split(',').map((s) => s.trim());
}

describe('LEVEL_COLORS (R13)', () => {
  it("equals the contract's LevelColor enum, in order", () => {
    expect(LEVEL_COLORS).toEqual(contractEnum('LevelColor'));
    expect(LEVEL_COLORS).toHaveLength(12);
  });

  it('is exported from the package', () => {
    expect(shared.LEVEL_COLORS).toBeDefined();
    expect(shared.LEVEL_COLORS).toBe(LEVEL_COLORS);
  });
});

describe('LAYOUT_LIMITS (FR-001 to FR-003, R5, R8)', () => {
  it('states every limit of a layout and an event seating save', () => {
    expect(LAYOUT_LIMITS).toEqual({
      maxSections: 100,
      maxRows: 100,
      maxSeatsPerRow: 200,
      maxSeats: 30_000,
      maxLevels: 12,
      maxCarriedLevels: 50,
      nameMaxLength: 50,
      labelMaxLength: 5,
      maxOutlinePoints: 64,
      maxMapUnits: 5_000,
      maxOffSaleSelectors: 5_000,
      maxImportBytes: 4 * 1024 * 1024,
    });
    expect(shared.LAYOUT_LIMITS).toBe(LAYOUT_LIMITS);
  });

  it("agrees with the contract's limits on a layout file", () => {
    const file = /\n {4}LayoutFile:\n[\s\S]*?\n {4}LayoutFileSection:/.exec(contract)?.[0] ?? '';
    expect(file).toContain(`maxItems: ${LAYOUT_LIMITS.maxSections}`);
    expect(file).toContain(`maxItems: ${LAYOUT_LIMITS.maxLevels}`);
    expect(file).toContain(`maxLength: ${LAYOUT_LIMITS.nameMaxLength}`);
  });
});
