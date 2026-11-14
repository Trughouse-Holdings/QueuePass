import { useId, useState } from 'react';
import { LAYOUT_LIMITS, checkBlock, seatCounts, type SectionGenerator } from '@queuepass/shared';
import type { EditorDoc } from './editor-doc';
import { totals } from './editor-state';

/** R7: the curve presets, the front row's arc in degrees. */
export const CURVES = [
  { label: 'None', degrees: 0 },
  { label: 'Slight', degrees: 20 },
  { label: 'Medium', degrees: 40 },
  { label: 'Strong', degrees: 60 },
] as const;

type Field = 'name' | keyof SectionGenerator;

/** The form's text, as typed. */
export interface BlockDraft {
  name: string;
  rows: string;
  seatsPerRow: string;
  rowLabels: SectionGenerator['rowLabels'];
  firstRow: string;
  firstSeat: string;
  direction: SectionGenerator['direction'];
  /** A preset's degrees, or 'custom'. */
  curvePreset: string;
  curve: string;
  levelId: string;
}

export const draftOf = (v: SectionGenerator, name: string, levelId: string): BlockDraft => {
  const preset = CURVES.find((c) => c.degrees === v.curve);
  return {
    name,
    rows: String(v.rows),
    seatsPerRow: v.seatsPerRow.join(', '),
    rowLabels: v.rowLabels,
    firstRow: v.firstRow,
    firstSeat: String(v.firstSeat),
    direction: v.direction,
    curvePreset: preset ? String(preset.degrees) : 'custom',
    curve: String(v.curve),
    levelId,
  };
};

export const NEW_BLOCK: SectionGenerator = {
  rows: 10,
  seatsPerRow: [20],
  rowLabels: 'LETTERS',
  firstRow: 'A',
  firstSeat: 1,
  direction: 'LEFT_TO_RIGHT',
  curve: 0,
};

const number = (s: string): number => (s.trim() === '' ? NaN : Number(s));

/**
 * The draft's generator values and every problem with them, by field (FR-006, R7): the shared
 * `checkBlock` limits ("At most 100 rows"), the name (`except` is the section being regenerated),
 * and the seats left under 30,000 (`seatsBefore` are the seats the layout keeps).
 */
export function readDraft(
  draft: BlockDraft,
  doc: EditorDoc,
  opts: { except?: string; seatsBefore: number; checkName: boolean },
): { values: SectionGenerator; problems: Partial<Record<Field, string>> } {
  const list = draft.seatsPerRow
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(number);
  const values: SectionGenerator = {
    rows: number(draft.rows),
    seatsPerRow: list,
    rowLabels: draft.rowLabels,
    firstRow: draft.firstRow.trim(),
    firstSeat: number(draft.firstSeat),
    direction: draft.direction,
    curve: draft.curvePreset === 'custom' ? number(draft.curve) : Number(draft.curvePreset),
  };
  const problems: Partial<Record<Field, string>> = {};
  if (opts.checkName) {
    const name = draft.name.trim();
    if (name === '') problems.name = 'Name the section';
    else if (name.length > LAYOUT_LIMITS.nameMaxLength)
      problems.name = `At most ${LAYOUT_LIMITS.nameMaxLength} characters`;
    else if (
      doc.sections.some((s) => s.id !== opts.except && s.name.toLowerCase() === name.toLowerCase())
    )
      problems.name = `Another section is named ${name}`;
    else if (!opts.except && doc.sections.length >= LAYOUT_LIMITS.maxSections)
      problems.name = `A layout has at most ${LAYOUT_LIMITS.maxSections} sections`;
  }
  if (list.some((n) => Number.isNaN(n)))
    problems.seatsPerRow = 'Seats per row: whole numbers, such as 20 or 16, 16, 18';
  for (const p of checkBlock(values)) problems[p.field] ??= p.message;
  if (!problems.seatsPerRow && !problems.rows) {
    const adding = seatCounts(values).reduce((a, b) => a + b, 0);
    const total = opts.seatsBefore + adding;
    if (total > LAYOUT_LIMITS.maxSeats)
      problems.seatsPerRow = `The layout would have ${total.toLocaleString()} seats; at most ${LAYOUT_LIMITS.maxSeats.toLocaleString()}`;
  }
  return { values, problems };
}

/**
 * Spec 039 US1 (FR-006, FR-007, FR-017; research R7; T032): Add section. A name; rows; seats per
 * row as one number or one a row; row labels (letters or numbers) and the first row; the first
 * seat and the numbering direction; a curve (a preset or degrees); the level. Each problem is
 * shown beside its field, naming the limit; the seats left under 30,000 are shown.
 */
export function AddSectionForm({
  doc,
  levelId,
  onGenerate,
  onCancel,
}: {
  doc: EditorDoc;
  levelId: string;
  onGenerate: (name: string, values: SectionGenerator, levelId: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [draft, setDraft] = useState<BlockDraft>(() => draftOf(NEW_BLOCK, '', levelId));
  const [problems, setProblems] = useState<Partial<Record<Field, string>>>({});
  const seatsLeft = totals(doc).seatsLeft;

  const submit = (): void => {
    const read = readDraft(draft, doc, { seatsBefore: totals(doc).seats, checkName: true });
    setProblems(read.problems);
    if (Object.keys(read.problems).length > 0) return;
    onGenerate(draft.name.trim(), read.values, draft.levelId);
  };

  return (
    <form
      className="form editor-form"
      aria-label="Add section"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <BlockFields
        doc={doc}
        draft={draft}
        onDraft={setDraft}
        problems={problems}
        withName
        withLevel
      />
      <p className="note">{`${seatsLeft.toLocaleString()} seats left in this layout`}</p>
      <div className="form__actions">
        <button type="submit" className="btn btn--primary">
          Generate
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** One field: its label, its input, its hint and its problem beside it. */
function Field({
  label,
  hint,
  problem,
  children,
}: {
  label: string;
  hint?: string;
  problem?: string;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }) => React.ReactNode;
}): React.ReactElement {
  const id = useId();
  const hintId = `${id}-hint`;
  const problemId = `${id}-problem`;
  const describedBy = [hint ? hintId : '', problem ? problemId : ''].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': problem ? true : undefined,
      })}
      {hint && (
        <span id={hintId} className="field__hint">
          {hint}
        </span>
      )}
      {problem && (
        <span id={problemId} className="editor-field-error">
          {problem}
        </span>
      )}
    </div>
  );
}

/** The generator's fields, for Add section and for Regenerate (FR-009). */
export function BlockFields({
  doc,
  draft,
  onDraft,
  problems,
  withName,
  withLevel,
}: {
  doc: EditorDoc;
  draft: BlockDraft;
  onDraft: (d: BlockDraft) => void;
  problems: Partial<Record<Field, string>>;
  withName?: boolean;
  withLevel?: boolean;
}): React.ReactElement {
  const set = (patch: Partial<BlockDraft>): void => onDraft({ ...draft, ...patch });
  return (
    <>
      {withName && (
        <Field label="Section name" problem={problems.name}>
          {(p) => (
            <input
              {...p}
              value={draft.name}
              maxLength={LAYOUT_LIMITS.nameMaxLength}
              onChange={(e) => set({ name: e.target.value })}
            />
          )}
        </Field>
      )}
      <Field label="Rows" problem={problems.rows}>
        {(p) => (
          <input
            {...p}
            type="number"
            min={1}
            max={LAYOUT_LIMITS.maxRows}
            value={draft.rows}
            onChange={(e) => set({ rows: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="Seats per row"
        hint="One number, or one for each row from the front: 16, 16, 18"
        problem={problems.seatsPerRow}
      >
        {(p) => (
          <input
            {...p}
            value={draft.seatsPerRow}
            onChange={(e) => set({ seatsPerRow: e.target.value })}
          />
        )}
      </Field>
      <Field label="Row labels" problem={problems.rowLabels}>
        {(p) => (
          <select
            {...p}
            value={draft.rowLabels}
            onChange={(e) => {
              const rowLabels = e.target.value as BlockDraft['rowLabels'];
              const firstRow =
                rowLabels === 'NUMBERS' && /^[A-Za-z]+$/.test(draft.firstRow)
                  ? '1'
                  : rowLabels === 'LETTERS' && /^\d+$/.test(draft.firstRow)
                    ? 'A'
                    : draft.firstRow;
              set({ rowLabels, firstRow });
            }}
          >
            <option value="LETTERS">Letters (A, B … Z, AA)</option>
            <option value="NUMBERS">Numbers (1, 2, 3)</option>
          </select>
        )}
      </Field>
      <Field label="First row" problem={problems.firstRow}>
        {(p) => (
          <input
            {...p}
            value={draft.firstRow}
            maxLength={LAYOUT_LIMITS.labelMaxLength}
            onChange={(e) => set({ firstRow: e.target.value })}
          />
        )}
      </Field>
      <Field label="First seat" problem={problems.firstSeat}>
        {(p) => (
          <input
            {...p}
            type="number"
            min={1}
            value={draft.firstSeat}
            onChange={(e) => set({ firstSeat: e.target.value })}
          />
        )}
      </Field>
      <Field label="Seat numbers" hint="As seen from the floor" problem={problems.direction}>
        {(p) => (
          <select
            {...p}
            value={draft.direction}
            onChange={(e) => set({ direction: e.target.value as BlockDraft['direction'] })}
          >
            <option value="LEFT_TO_RIGHT">Left to right</option>
            <option value="RIGHT_TO_LEFT">Right to left</option>
          </select>
        )}
      </Field>
      <Field label="Curve" problem={draft.curvePreset === 'custom' ? undefined : problems.curve}>
        {(p) => (
          <select
            {...p}
            value={draft.curvePreset}
            onChange={(e) => {
              const curvePreset = e.target.value;
              set({ curvePreset, curve: curvePreset === 'custom' ? draft.curve : curvePreset });
            }}
          >
            {CURVES.map((c) => (
              <option key={c.label} value={String(c.degrees)}>
                {c.label}
              </option>
            ))}
            <option value="custom">Degrees…</option>
          </select>
        )}
      </Field>
      {draft.curvePreset === 'custom' && (
        <Field label="Curve in degrees" hint="0 (straight) to 120" problem={problems.curve}>
          {(p) => (
            <input
              {...p}
              type="number"
              min={0}
              max={120}
              value={draft.curve}
              onChange={(e) => set({ curve: e.target.value })}
            />
          )}
        </Field>
      )}
      {withLevel && (
        <Field label="Price level">
          {(p) => (
            <select {...p} value={draft.levelId} onChange={(e) => set({ levelId: e.target.value })}>
              {doc.levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
    </>
  );
}
