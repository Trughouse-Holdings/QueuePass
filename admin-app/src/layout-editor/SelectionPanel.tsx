import { LAYOUT_LIMITS } from '@queuepass/shared';
import { levelName, type EditorDoc } from './editor-doc';
import { FLOOR_NAMES, seatCount, type Action, type Selection } from './editor-state';
import { NumberBox } from './NumberBox';

/**
 * Spec 039 FR-011, FR-026 (research R6, R14; T026, T050, T053): what is selected. For one
 * section, its place (x, y) and angle as number boxes: a typed place moves it, a typed angle turns
 * it about its origin.
 */
export function SelectionPanel({
  doc,
  selection,
  dispatch,
  children,
}: {
  doc: EditorDoc;
  selection: Selection;
  dispatch: (a: Action) => void;
  children?: React.ReactNode;
}): React.ReactElement {
  const one =
    selection.kind === 'sections' && selection.ids.length === 1
      ? doc.sections.find((s) => s.id === selection.ids[0])
      : undefined;
  const max = LAYOUT_LIMITS.maxMapUnits;
  return (
    <section className="card editor-panel" aria-labelledby="editor-selection-heading">
      <h2 id="editor-selection-heading">Selection</h2>
      {selection.kind === 'none' && <p className="note">Nothing selected.</p>}
      {selection.kind === 'floor' && <p>{`Floor object: ${FLOOR_NAMES[doc.floor.kind]}`}</p>}
      {selection.kind === 'sections' && !one && (
        <p>{`${selection.ids.length} sections selected`}</p>
      )}
      {one && (
        <>
          <h3>{`Section ${one.name}`}</h3>
          <p className="note">
            {`${levelName(doc, one.levelId)} · ${seatCount(one).toLocaleString()} seats`}
          </p>
          <div className="editor-place">
            <NumberBox
              label="x"
              value={one.origin[0]}
              min={0}
              max={max}
              onValue={(x) =>
                dispatch({ type: 'placeSection', id: one.id, origin: [x, one.origin[1]] })
              }
            />
            <NumberBox
              label="y"
              value={one.origin[1]}
              min={0}
              max={max}
              onValue={(y) =>
                dispatch({ type: 'placeSection', id: one.id, origin: [one.origin[0], y] })
              }
            />
            <NumberBox
              label="Angle"
              value={one.angle}
              min={-180}
              max={180}
              onValue={(angle) => dispatch({ type: 'placeSection', id: one.id, angle })}
            />
          </div>
        </>
      )}
      {children}
    </section>
  );
}
