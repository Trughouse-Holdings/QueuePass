import type { LevelColor } from '@queuepass/shared';
import { levelName, seatLevel, type EdSection, type EditorDoc, type Place } from './editor-doc';
import type { Action, Selection } from './editor-state';

/** The seats' spacing (2 units) and how they are drawn from it, as the shared map draws them. */
const SPACING = 2;
const RADIUS = SPACING * 0.4;

/**
 * Spec 039 US2, US4 (FR-012, FR-016; research R2, R11; T044, T051): the seats of the section
 * zoomed into, each at its place in its level's color (`.venue-map--<color>`), with the row's label
 * at both ends of each row. A seat is a button named "Row A, Seat 1, Courtside" (", accessible"
 * when marked), pressed when selected: click selects it, Shift-click adds or removes it. A row
 * label selects its row, Shift-click on another the rows between. Seats are not tab stops (a
 * section may hold 900): the Selection panel's row and seat lists are the keyboard path (FR-026).
 */
export function SectionSeatsView({
  doc,
  section,
  selection,
  dispatch,
}: {
  doc: EditorDoc;
  section: EdSection;
  selection: Selection;
  dispatch: (a: Action) => void;
}): React.ReactElement {
  const colorOf = new Map<string, LevelColor>(doc.levels.map((l) => [l.id, l.color]));
  const inSection = 'sectionId' in selection && selection.sectionId === section.id;
  const rowsOn = new Set(inSection && selection.kind === 'rows' ? selection.ids : []);
  const seatsOn = new Set(inSection && selection.kind === 'seats' ? selection.ids : []);

  return (
    <g className="editor-map__seats">
      {section.rows.map((row) => {
        const first = row.seats[0];
        const last = row.seats[row.seats.length - 1];
        let dir: Place = [1, 0];
        if (first && last && row.seats.length > 1) {
          const dx = last.at[0] - first.at[0];
          const dy = last.at[1] - first.at[1];
          const len = Math.hypot(dx, dy) || 1;
          dir = [dx / len, dy / len];
        }
        const ends: Place[] =
          first && last
            ? [
                [first.at[0] - dir[0] * SPACING * 1.2, first.at[1] - dir[1] * SPACING * 1.2],
                [last.at[0] + dir[0] * SPACING * 1.2, last.at[1] + dir[1] * SPACING * 1.2],
              ]
            : [];
        const pressRow = (e: React.PointerEvent): void => {
          e.stopPropagation();
          dispatch(
            e.shiftKey
              ? { type: 'selectRowRange', sectionId: section.id, toId: row.id }
              : { type: 'selectRows', sectionId: section.id, ids: [row.id] },
          );
        };
        return (
          <g key={row.id} className="editor-map__row">
            {ends.map(([x, y], i) => (
              <text
                key={i}
                className={`editor-map__row-label${rowsOn.has(row.id) ? ' editor-map__row-label--selected' : ''}`}
                x={x}
                y={y}
                fontSize={SPACING * 0.8}
                textAnchor="middle"
                dominantBaseline="central"
                // The first end is the row's button; the second repeats it for the pointer.
                role={i === 0 ? 'button' : undefined}
                aria-label={i === 0 ? `Row ${row.label}` : undefined}
                aria-pressed={i === 0 ? rowsOn.has(row.id) : undefined}
                aria-hidden={i === 0 ? undefined : true}
                onPointerDown={pressRow}
              >
                {row.label}
              </text>
            ))}
            {row.seats.map((s) => {
              const level = seatLevel(section, row, s);
              const on = seatsOn.has(s.id) || rowsOn.has(row.id);
              return (
                <g
                  key={s.id}
                  role="button"
                  tabIndex={-1}
                  aria-pressed={on}
                  aria-label={`Row ${row.label}, Seat ${s.label}, ${levelName(doc, level)}${
                    s.accessible ? ', accessible' : ''
                  }`}
                  className={`editor-map__seat${on ? ' editor-map__seat--selected' : ''}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    dispatch({
                      type: 'selectSeats',
                      sectionId: section.id,
                      ids: [s.id],
                      add: e.shiftKey,
                    });
                  }}
                >
                  <circle
                    className={`editor-map__dot venue-map--${colorOf.get(level) ?? 'violet'}`}
                    cx={s.at[0]}
                    cy={s.at[1]}
                    r={RADIUS}
                  />
                  {s.accessible && (
                    <circle
                      className="editor-map__accessible"
                      cx={s.at[0]}
                      cy={s.at[1]}
                      r={RADIUS * 0.45}
                    />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

/** The seats of a section inside a box of map places. */
export function seatsInBox(section: EdSection, a: Place, b: Place): string[] {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return section.rows.flatMap((r) =>
    r.seats
      .filter((s) => s.at[0] >= x0 && s.at[0] <= x1 && s.at[1] >= y0 && s.at[1] <= y1)
      .map((s) => s.id),
  );
}
