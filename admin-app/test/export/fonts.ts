import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Spec 023 (research R10): the committed Noto Sans files, read from disk for tests. */
const FONTS = join(dirname(fileURLToPath(import.meta.url)), '../../src/export/fonts');
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FONTS, name)));

export const REGULAR = read('NotoSans-Regular.ttf');
export const BOLD = read('NotoSans-Bold.ttf');
export const loadFontsFromDisk = async () => ({ regular: REGULAR, bold: BOLD });
