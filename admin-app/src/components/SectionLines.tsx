import { useId } from 'react';
import { LEVEL_COLORS, type LayoutLinesInput, type LevelColor } from '@queuepass/shared';

/** Spec 038 FR-005: a price level being edited: its name and one of the theme's 12 colors. */
export type LevelLine = { name: string; color: LevelColor };

/** One section being edited: kept as typed text until it is sent; its level by name. */
export type SectionLine = { name: string; rows: string; seatsPerRow: string; level: string };

export const NEW_LEVEL: LevelLine = { name: '', color: 'violet' };

/** A new line, in `level` (the first level, when there is one). */
export const newLine = (level = ''): SectionLine => ({
  name: '',
  rows: '1',
  seatsPerRow: '1',
  level,
});

/**
 * Spec 038 (research R6): the request the lines make (`createVenueLayout`, `updateVenueLayout`):
 * names trimmed, numbers as numbers, the levels in rank order.
 */
export const toLinesInput = (
  name: string,
  levels: LevelLine[],
  lines: SectionLine[],
): LayoutLinesInput => ({
  name: name.trim(),
  levels: levels.map((l) => ({ name: l.name.trim(), color: l.color })),
  sections: lines.map((l) => ({
    name: l.name.trim(),
    rows: Number(l.rows),
    seatsPerRow: Number(l.seatsPerRow),
    level: l.level.trim(),
  })),
});

/** A line's seats as typed; a line that is not a number yet counts as 0. */
const lineSeats = (l: SectionLine): number => (Number(l.rows) || 0) * (Number(l.seatsPerRow) || 0);

/** Seats in the lines as typed (spec 024 FR-022: the sum of the lines' seats). */
export const totalSeats = (lines: SectionLine[]): number =>
  lines.reduce((n, l) => n + lineSeats(l), 0);

/**
 * Spec 007 US1 and spec 008 US5: a venue's sections as editable lines (name, rows, seats per row),
 * with Add and Remove. Shared by the venue page's Layouts card and the New venue form.
 *
 * Spec 024 US3 (FR-018 to FR-021, research R8): one hint above the lines says what a section
 * is; each line shows visible labels "Section name", "Rows" × "Seats per row" and its seats
 * ("= 200 seats"). Each box is named by its line's legend and its visible label ("Section 1
 * Rows"), so the spoken name contains the visible one (WCAG 2.5.3).
 *
 * Spec 038 FR-005 (research R6, R15): above the lines, the layout's price levels, most desirable
 * first, each a name and a color; each line has a "Price level" chosen from them. Renaming a level
 * renames it in every line that uses it.
 */
export function SectionLines({
  levels,
  onLevelsChange,
  lines,
  onChange,
}: {
  levels: LevelLine[];
  onLevelsChange: (levels: LevelLine[]) => void;
  lines: SectionLine[];
  onChange: (lines: SectionLine[]) => void;
}): React.ReactElement {
  const prefix = useId();
  const edit = (i: number, change: Partial<SectionLine>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...change } : l)));
  const editLevel = (i: number, change: Partial<LevelLine>) => {
    const before = levels[i].name;
    onLevelsChange(levels.map((l, j) => (j === i ? { ...l, ...change } : l)));
    if (change.name !== undefined && change.name !== before) {
      onChange(lines.map((l) => (l.level === before ? { ...l, level: change.name! } : l)));
    }
  };
  const named = levels.map((l) => l.name).filter((n) => n.trim() !== '');

  return (
    <>
      <p className="field__hint">
        Price levels, most desirable first. Each event that uses the layout sets a price for each
        level.
      </p>
      {levels.map((l, i) => {
        const id = (part: string) => `${prefix}-level-${i}-${part}`;
        const label = (part: string) => `${id('legend')} ${id(part)}`;
        return (
          <fieldset key={i} className="form__row form__row--level">
            <legend id={id('legend')}>{`Level ${i + 1}`}</legend>
            <div className="field">
              <label id={id('name-label')} htmlFor={id('name')}>
                Level name
              </label>
              <input
                id={id('name')}
                aria-labelledby={label('name-label')}
                value={l.name}
                onChange={(e) => editLevel(i, { name: e.target.value })}
              />
            </div>
            <div className="field">
              <label id={id('color-label')} htmlFor={id('color')}>
                Color
              </label>
              <select
                id={id('color')}
                aria-labelledby={label('color-label')}
                value={l.color}
                onChange={(e) => editLevel(i, { color: e.target.value as LevelColor })}
              >
                {LEVEL_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => onLevelsChange(levels.filter((_, j) => j !== i))}
            >
              Remove level {i + 1}
            </button>
          </fieldset>
        );
      })}
      <div>
        <button
          type="button"
          className="btn"
          onClick={() => onLevelsChange([...levels, NEW_LEVEL])}
        >
          Add level
        </button>
      </div>

      <p className="field__hint">
        A section is a grid of seats: rows run front to back, and every row has the same number of
        seats across.
      </p>
      {lines.map((l, i) => {
        const id = (part: string) => `${prefix}-${i}-${part}`;
        const label = (part: string) => `${id('legend')} ${id(part)}`;
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
                aria-labelledby={label('name-label')}
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
                aria-labelledby={label('rows-label')}
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
                aria-labelledby={label('seats-label')}
                value={l.seatsPerRow}
                onChange={(e) => edit(i, { seatsPerRow: e.target.value })}
              />
            </div>
            <div className="field section-line__level">
              <label id={id('level-label')} htmlFor={id('level')}>
                Price level
              </label>
              <select
                id={id('level')}
                aria-labelledby={label('level-label')}
                value={l.level}
                onChange={(e) => edit(i, { level: e.target.value })}
              >
                {!named.includes(l.level) && <option value={l.level}>Choose a level</option>}
                {named.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
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
        <button
          type="button"
          className="btn"
          onClick={() => onChange([...lines, newLine(named[0] ?? '')])}
        >
          Add section
        </button>
      </div>
    </>
  );
}
