/**
 * Spec 037 research R14 (T073): writes the layout editor's fixtures and parity outputs for
 * `core/tests/editor_*.rs`. The React editor's own functions run here on fixed inputs, and the Rust
 * ports must give the same results, every number to the same float.
 *
 * Run from the repository root (with `node_modules` linked):
 *   npx tsx admin-rust-app/core/tests/fixtures/editor/make-fixtures.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRAWING, LOCKED } from '../../../../../admin-app/test/layout-editor/fixtures';
import {
  emptyDoc,
  fromDrawing,
  mapSize,
  toInput,
  type EditorDoc,
} from '../../../../../admin-app/src/layout-editor/editor-doc';
import {
  currentDoc,
  initState,
  isDirty,
  reduce,
  regeneratePlan,
  totals,
  type Action,
  type EditorState,
} from '../../../../../admin-app/src/layout-editor/editor-state';
import { warningsOf } from '../../../../../admin-app/src/layout-editor/overlap';
import {
  NEW_BLOCK,
  draftOf,
  readDraft,
  type BlockDraft,
} from '../../../../../admin-app/src/layout-editor/AddSectionForm';
import { mapFit } from '../../../../../admin-app/src/layout-editor/EditorCanvas';
import { shown } from '../../../../../admin-app/src/layout-editor/NumberBox';

const here = dirname(fileURLToPath(import.meta.url));
const write = (name: string, value: unknown): void =>
  writeFileSync(join(here, name), `${JSON.stringify(value)}\n`);

write('drawing.json', DRAWING);
write('locked.json', LOCKED);

/** A step of a scenario: an action, or `saveNow` (saved, read back with server ids). */
type Step = Action | { type: 'saveNow'; readBack: boolean };

const BLOCK = { ...NEW_BLOCK, rows: 3, seatsPerRow: [4] };
const CURVED = { ...NEW_BLOCK, rows: 4, seatsPerRow: [6, 7, 8, 9], curve: 40 };

const scenarios: { name: string; start: 'drawing' | 'empty'; steps: Step[] }[] = [
  {
    name: 'move turn place',
    start: 'drawing',
    steps: [
      { type: 'selectSections', ids: ['s-101'] },
      { type: 'moveSections', ids: ['s-101'], dx: 3.3, dy: -1.7 },
      { type: 'turnSections', ids: ['s-101'], degrees: 37 },
      { type: 'turnSections', ids: ['s-101', 's-102'], degrees: -125 },
      { type: 'placeSection', id: 's-102', angle: 33.3 },
      { type: 'placeSection', id: 's-102', angle: -170.25 },
      { type: 'placeSection', id: 's-101', origin: [12.5, 40] },
      { type: 'placeSection', id: 's-101', origin: [2, 3] },
      { type: 'moveSections', ids: ['s-102'], dx: 9000, dy: 9000 },
      { type: 'moveSections', ids: ['s-101'], dx: -50, dy: -50 },
      { type: 'undo' },
      { type: 'undo' },
      { type: 'redo' },
      { type: 'turnSections', ids: ['s-101'], degrees: 720 },
      { type: 'turnSections', ids: ['nope'], degrees: 5 },
    ],
  },
  {
    name: 'floor',
    start: 'empty',
    steps: [
      { type: 'setFloor', kind: 'END_STAGE', at: [20, 5] },
      { type: 'setFloor', kind: 'CENTER_STAGE', at: [0, 0] },
      { type: 'moveFloor', dx: -100, dy: 7.25 },
      { type: 'resizeFloor', to: { x: 3.3, y: 4.4, width: 77.7, height: 0.5 } },
      { type: 'resizeFloor', to: { x: 3.3, y: 4.4, width: 77.7, height: 31.1 } },
      { type: 'moveFloor', dx: 0, dy: 0 },
      { type: 'clearSelection' },
      { type: 'selectFloor' },
      { type: 'setFloor', kind: 'NONE', at: [0, 0] },
      { type: 'selectFloor' },
      { type: 'undo' },
      { type: 'setFloor', kind: 'RING', at: [150, 100] },
    ],
  },
  {
    name: 'generate and regenerate',
    start: 'empty',
    steps: [
      { type: 'rename', name: 'B' },
      { type: 'rename', name: 'Bowl ' },
      { type: 'addSection', name: ' 101 ', values: CURVED, levelId: 'new:0', at: [150, 100] },
      { type: 'addSection', name: 'Edge', values: BLOCK, levelId: 'new:0', at: [1, 1] },
      {
        type: 'addSection',
        name: 'Bad',
        values: { ...BLOCK, rows: 0 },
        levelId: 'new:0',
        at: [10, 10],
      },
      { type: 'turnSections', ids: ['new:35'], degrees: 15 },
      { type: 'duplicateSection', id: 'new:35' },
      { type: 'duplicateSection', id: 'new:35' },
      { type: 'regenerate', id: 'new:35', values: { ...CURVED, rows: 3, curve: 60 } },
      {
        type: 'regenerate',
        id: 'new:35',
        values: { ...CURVED, rows: 5, seatsPerRow: [10], direction: 'RIGHT_TO_LEFT' },
      },
      { type: 'renameSection', id: 'new:35', name: 'edge' },
      { type: 'renameSection', id: 'new:35', name: ' Lower 101 ' },
      { type: 'undo' },
      { type: 'redo' },
      { type: 'deleteSections', ids: ['new:87'] },
      { type: 'zoom', id: 'new:35' },
      { type: 'deleteSections', ids: ['new:35', 'new:52'] },
    ],
  },
  {
    name: 'levels and painting',
    start: 'drawing',
    steps: [
      { type: 'addLevel' },
      { type: 'addLevel' },
      { type: 'renameLevel', id: 'new:1', name: 'level 4' },
      { type: 'renameLevel', id: 'new:1', name: ' Upper ' },
      { type: 'renameLevel', id: 'new:1', name: 'Upper' },
      { type: 'recolorLevel', id: 'new:1', color: 'brown' },
      { type: 'moveLevel', id: 'new:1', by: -1 },
      { type: 'moveLevel', id: 'lv-court', by: -1 },
      { type: 'selectSections', ids: ['s-101', 's-102'] },
      { type: 'paint', levelId: 'new:1' },
      { type: 'clearLevel' },
      { type: 'selectRows', sectionId: 's-101', ids: ['r-101-b'] },
      { type: 'selectRows', sectionId: 's-101', ids: ['r-101-a'], add: true },
      { type: 'paint', levelId: 'lv-std' },
      { type: 'clearLevel' },
      { type: 'selectSeats', sectionId: 's-101', ids: ['st-a1', 'st-b2'] },
      { type: 'paint', levelId: 'new:2' },
      { type: 'deleteLevel', id: 'new:2', replacement: 'lv-court' },
      { type: 'deleteLevel', id: 'lv-court', replacement: 'new:1' },
      { type: 'undo' },
      { type: 'zoom', id: null },
      { type: 'toggleSection', id: 's-102' },
    ],
  },
  {
    name: 'seats and labels',
    start: 'drawing',
    steps: [
      { type: 'zoom', id: 's-101' },
      { type: 'selectRowRange', sectionId: 's-101', toId: 'r-101-b' },
      { type: 'selectRows', sectionId: 's-101', ids: ['r-101-a'] },
      { type: 'selectRowRange', sectionId: 's-101', toId: 'r-101-b' },
      { type: 'relabelRow', sectionId: 's-101', rowId: 'r-101-b', label: ' bb ' },
      { type: 'relabelRow', sectionId: 's-101', rowId: 'r-101-b', label: 'a' },
      { type: 'relabelSeat', sectionId: 's-101', seatId: 'st-a3', label: '3' },
      { type: 'relabelSeat', sectionId: 's-101', seatId: 'st-a3', label: '9' },
      { type: 'markAccessible', sectionId: 's-101', ids: ['st-a1'], accessible: true },
      { type: 'markAccessible', sectionId: 's-101', ids: ['st-a2', 'st-a3'], accessible: true },
      { type: 'selectSeats', sectionId: 's-101', ids: ['st-a2', 'st-b1'] },
      { type: 'deleteSeats', sectionId: 's-101', ids: ['st-a2', 'st-b1'] },
      { type: 'deleteSeats', sectionId: 's-102', ids: ['st-102-1', 'st-102-2'] },
      { type: 'deleteSeats', sectionId: 's-101', ids: [] },
      { type: 'undo' },
      { type: 'selectSeats', sectionId: 's-101', ids: ['st-b1'] },
      { type: 'redo' },
      { type: 'zoom', id: null },
    ],
  },
  {
    name: 'save and remap',
    start: 'drawing',
    steps: [
      { type: 'addSection', name: '103', values: BLOCK, levelId: 'lv-std', at: [150, 100] },
      { type: 'addLevel' },
      { type: 'selectRows', sectionId: 'new:16', ids: ['new:1', 'new:6'] },
      { type: 'paint', levelId: 'new:17' },
      { type: 'zoom', id: 'new:16' },
      { type: 'saveNow', readBack: true },
      { type: 'undo' },
      { type: 'undo' },
      { type: 'redo' },
      { type: 'moveSections', ids: ['s-101'], dx: 1, dy: 1 },
      { type: 'saveNow', readBack: false },
      { type: 'rename', name: 'After' },
    ],
  },
];

const server = (id: string): string => (id.startsWith('new:') ? `srv-${id.slice(4)}` : id);
const readBack = (sent: EditorDoc): EditorDoc => ({
  ...sent,
  levels: sent.levels.map((l) => ({ ...l, id: server(l.id) })),
  sections: sent.sections.map((x) => ({
    ...x,
    id: server(x.id),
    levelId: server(x.levelId),
    rows: x.rows.map((r) => ({
      ...r,
      id: server(r.id),
      levelId: r.levelId && server(r.levelId),
      seats: r.seats.map((q) => ({
        ...q,
        id: server(q.id),
        levelId: q.levelId && server(q.levelId),
      })),
    })),
  })),
});

const snapshot = (s: EditorState) => ({
  doc: currentDoc(s),
  message: s.message,
  cursor: s.cursor,
  historyLength: s.history.length,
  step: s.steps[s.cursor],
  selection: s.selection,
  zoomed: s.zoomed,
  seq: s.seq,
  typing: s.typing,
  dirty: isDirty(s),
  savedName: s.saved.name,
  totals: totals(currentDoc(s)),
  input: toInput(currentDoc(s), 7),
  warnings: { ...warningsOf(currentDoc(s)), sections: [...warningsOf(currentDoc(s)).sections] },
  mapFit: mapFit(currentDoc(s)),
  mapSize: mapSize(currentDoc(s)),
});

write(
  'scenarios.json',
  scenarios.map(({ name, start, steps }) => {
    let s = initState(start === 'drawing' ? fromDrawing(DRAWING) : emptyDoc());
    const after = steps.map((step) => {
      if (step.type === 'saveNow') {
        const sent = currentDoc(s);
        s = reduce(s, step.readBack ? { type: 'saved', sent, doc: readBack(sent) } : { type: 'saved', sent });
      } else {
        s = reduce(s, step);
      }
      return snapshot(s);
    });
    return { name, start, steps, after };
  }),
);

// readDraft on drafts as typed, with JavaScript's Number() and split.
const base = draftOf(NEW_BLOCK, '104', 'lv-std');
const drafts: { draft: BlockDraft; except?: string; seatsBefore: number; checkName: boolean }[] = [
  { draft: base, seatsBefore: 8, checkName: true },
  { draft: { ...base, name: ' 101 ' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, name: '101' }, except: 's-101', seatsBefore: 2, checkName: true },
  { draft: { ...base, name: '' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, name: 'x'.repeat(51) }, seatsBefore: 8, checkName: true },
  { draft: { ...base, name: '' }, seatsBefore: 8, checkName: false },
  { draft: { ...base, rows: ' 12 ', seatsPerRow: '  16,16 , 18\t18,,20 20 ' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, rows: '6', seatsPerRow: '16, 16, 18, 18, 20, 20' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, rows: '0x10', seatsPerRow: '1e1, .5e1, +3, 0b11, 0o7' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, rows: '', seatsPerRow: '' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, rows: '2.5', seatsPerRow: '20, x' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, rows: '101', seatsPerRow: '201' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, rows: '100', seatsPerRow: '200' }, seatsBefore: 20000, checkName: true },
  { draft: { ...base, rows: '100', seatsPerRow: '200' }, seatsBefore: 10000, checkName: true },
  { draft: { ...base, firstRow: ' AB ' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, firstRow: ' zz ' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, rowLabels: 'NUMBERS', firstRow: '99999' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, firstSeat: '1e4', direction: 'RIGHT_TO_LEFT' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, firstSeat: 'Infinity' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, curvePreset: '40', curve: 'junk' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, curvePreset: 'custom', curve: '121' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, curvePreset: 'custom', curve: ' 25.5 ' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, curvePreset: 'custom', curve: '-0' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, rows: '3', seatsPerRow: '4, 5' }, seatsBefore: 8, checkName: true },
  { draft: { ...base, rows: '1_0', seatsPerRow: '1.', firstSeat: '-1' }, seatsBefore: 8, checkName: true },
];
const many = { ...fromDrawing(DRAWING) };
many.sections = Array.from({ length: 100 }, (_, i) => ({ ...many.sections[0], id: `s${i}`, name: `S${i}` }));
write('drafts.json', [
  ...drafts.map((d) => ({
    ...d,
    many: false,
    out: readDraft(d.draft, fromDrawing(DRAWING), d),
  })),
  ...[{ draft: base, seatsBefore: 0, checkName: true }].map((d) => ({
    ...d,
    many: true,
    out: readDraft(d.draft, many, d),
  })),
]);

// regeneratePlan, and the number box's display.
const doc = fromDrawing(DRAWING);
write('plans.json', [
  { id: 's-101', values: { ...NEW_BLOCK, rows: 3, seatsPerRow: [2] }, out: regeneratePlan(doc, 's-101', { ...NEW_BLOCK, rows: 3, seatsPerRow: [2] }) },
  { id: 's-101', values: { ...NEW_BLOCK, rows: 2, seatsPerRow: [3] }, out: regeneratePlan(doc, 's-101', { ...NEW_BLOCK, rows: 2, seatsPerRow: [3] }) },
  { id: 's-102', values: { ...NEW_BLOCK, rows: 1, seatsPerRow: [1] }, out: regeneratePlan(doc, 's-102', { ...NEW_BLOCK, rows: 1, seatsPerRow: [1] }) },
  { id: 'nope', values: NEW_BLOCK, out: regeneratePlan(doc, 'nope', NEW_BLOCK) },
]);
write(
  'shown.json',
  [0, -0, -0.04, 0.05, -0.05, 1.25, -1.25, 2.35, 100.04, 1e21, 123456.789, -179.97, 0.1 + 0.2].map(
    (n) => ({ n: Object.is(n, -0) ? '-0' : n, out: shown(n) }),
  ),
);
