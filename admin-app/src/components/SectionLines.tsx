import { useId } from 'react';
import type { SectionInput } from '@queuepass/shared';

/** One section being edited: kept as typed text until it is sent. */
export type SectionLine = { name: string; rows: string; seatsPerRow: string };

export const NEW_LINE: SectionLine = { name: '', rows: '1', seatsPerRow: '1' };

export const toSectionInputs = (lines: SectionLine[]): SectionInput[] =>
  lines.map((l) => ({ name: l.name, rows: Number(l.rows), seatsPerRow: Number(l.seatsPerRow) }));

/** A line's seats as typed; a line that is not a number yet counts as 0. */
const lineSeats = (l: SectionLine): number => (Number(l.rows) || 0) * (Number(l.seatsPerRow) || 0);

/** Seats in the lines as typed (spec 024 FR-022: the sum of the lines' seats). */
export const totalSeats = (lines: SectionLine[]): number =>
  lines.reduce((n, l) => n + lineSeats(l), 0);

/**
 * Spec 007 US1 and spec 008 US5: a venue's sections as editable lines (name, rows, seats per row),
 * with Add and Remove. Shared by the venue page's layout editor and the New venue form.
 *
 * Spec 024 US3 (FR-018 to FR-021, research R8): one hint above the lines says what a section
 * is; each line shows visible labels "Section name", "Rows" × "Seats per row" and its seats
 * ("= 200 seats"). Each box is named by its line's legend and its visible label ("Section 1
 * Rows"), so the spoken name contains the visible one (WCAG 2.5.3).
 */
export function SectionLines({
  lines,
  onChange,
}: {
  lines: SectionLine[];
  onChange: (lines: SectionLine[]) => void;
}): React.ReactElement {
  const prefix = useId();
  const edit = (i: number, change: Partial<SectionLine>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...change } : l)));

  return (
    <>
      <p className="field__hint">
        A section is a grid of seats: rows run front to back, and every row has the same number of
        seats across.
      </p>
      {lines.map((l, i) => {
        const id = (part: string) => `${prefix}-${i}-${part}`;
        const named = (label: string) => `${id('legend')} ${id(label)}`;
        const seats = lineSeats(l);
        return (
          <fieldset key={i} className="form__row form__row--section">
            <legend id={id('legend')}>{`Section ${i + 1}`}</legend>
            <div className="field">
              <label id={id('name-label')} htmlFor={id('name')}>
                Section name
              </label>
              <input
                id={id('name')}
                aria-labelledby={named('name-label')}
                value={l.name}
                onChange={(e) => edit(i, { name: e.target.value })}
              />
            </div>
            <div className="field">
              <label id={id('rows-label')} htmlFor={id('rows')}>
                Rows
              </label>
              <input
                id={id('rows')}
                type="number"
                min={1}
                max={100}
                aria-labelledby={named('rows-label')}
                value={l.rows}
                onChange={(e) => edit(i, { rows: e.target.value })}
              />
            </div>
            <span className="section-line__times" aria-hidden="true">
              ×
            </span>
            <div className="field">
              <label id={id('seats-label')} htmlFor={id('seats')}>
                Seats per row
              </label>
              <input
                id={id('seats')}
                type="number"
                min={1}
                max={200}
                aria-labelledby={named('seats-label')}
                value={l.seatsPerRow}
                onChange={(e) => edit(i, { seatsPerRow: e.target.value })}
              />
            </div>
            <span className="section-line__seats">{`= ${seats.toLocaleString()} ${
              seats === 1 ? 'seat' : 'seats'
            }`}</span>
            <button
              type="button"
              className="btn"
              onClick={() => onChange(lines.filter((_, j) => j !== i))}
            >
              Remove section {i + 1}
            </button>
          </fieldset>
        );
      })}
      <div>
        <button type="button" className="btn" onClick={() => onChange([...lines, NEW_LINE])}>
          Add section
        </button>
      </div>
    </>
  );
}
