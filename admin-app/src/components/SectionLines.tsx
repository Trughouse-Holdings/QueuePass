import type { SectionInput } from '@queuepass/shared';

/** One section being edited: kept as typed text until it is sent. */
export type SectionLine = { name: string; rows: string; seatsPerRow: string };

export const NEW_LINE: SectionLine = { name: '', rows: '1', seatsPerRow: '1' };

export const toSectionInputs = (lines: SectionLine[]): SectionInput[] =>
  lines.map((l) => ({ name: l.name, rows: Number(l.rows), seatsPerRow: Number(l.seatsPerRow) }));

/** Seats in the lines as typed; a line that is not a number yet counts as 0. */
export const totalSeats = (lines: SectionLine[]): number =>
  lines.reduce((n, l) => n + (Number(l.rows) || 0) * (Number(l.seatsPerRow) || 0), 0);

/**
 * Spec 007 US1 and spec 008 US5: a venue's sections as editable lines (name, rows, seats per row),
 * with Add and Remove. Shared by the venue page's layout editor and the New venue form.
 */
export function SectionLines({
  lines,
  onChange,
}: {
  lines: SectionLine[];
  onChange: (lines: SectionLine[]) => void;
}): React.ReactElement {
  const edit = (i: number, change: Partial<SectionLine>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...change } : l)));

  return (
    <>
      {lines.map((l, i) => (
        <fieldset key={i} className="form__row">
          <legend>Section {i + 1}</legend>
          <input
            aria-label={`Section ${i + 1} name`}
            value={l.name}
            onChange={(e) => edit(i, { name: e.target.value })}
          />
          <input
            type="number"
            min={1}
            max={100}
            aria-label={`Section ${i + 1} rows`}
            value={l.rows}
            onChange={(e) => edit(i, { rows: e.target.value })}
          />
          <input
            type="number"
            min={1}
            max={200}
            aria-label={`Section ${i + 1} seats per row`}
            value={l.seatsPerRow}
            onChange={(e) => edit(i, { seatsPerRow: e.target.value })}
          />
          <button
            type="button"
            className="btn"
            onClick={() => onChange(lines.filter((_, j) => j !== i))}
          >
            Remove section {i + 1}
          </button>
        </fieldset>
      ))}
      <div>
        <button type="button" className="btn" onClick={() => onChange([...lines, NEW_LINE])}>
          Add section
        </button>
      </div>
    </>
  );
}
