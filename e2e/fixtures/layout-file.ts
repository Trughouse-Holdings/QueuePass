import type { Page } from '@playwright/test';
import type { LayoutFile } from './api';

/**
 * 2026-11-19: a new venue starts from a layout file. A small valid format-1 file named `name`:
 * one section "Floor" of `rows` rows with `seatsPerRow` seats each, in one level "Standard".
 */
export function gridLayoutFile(rows: number, seatsPerRow: number, name = 'Grid'): LayoutFile {
  return {
    format: 1,
    name,
    floor: { kind: 'NONE' },
    size: { width: 5000, height: 5000 },
    levels: [{ key: 'standard', name: 'Standard', rank: 1, color: 'violet' }],
    sections: [
      {
        name: 'Floor',
        level: 'standard',
        outline: [
          [10, 10],
          [4990, 10],
          [4990, 4990],
          [10, 4990],
        ],
        rows: Array.from({ length: rows }, (_, r) => ({
          label: String(r + 1),
          seats: {
            first: 1,
            count: seatsPerRow,
            from: [1000, 1000 + r * 100],
            to: [4000, 1000 + r * 100],
          },
        })),
      },
    ],
  } as LayoutFile;
}

/** Chooses `file` in the New venue form's Layout file box, as a JSON file. */
export async function chooseLayoutFile(page: Page, file: LayoutFile, fileName = 'layout.json') {
  await page.getByLabel('Layout file', { exact: true }).setInputFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
}
