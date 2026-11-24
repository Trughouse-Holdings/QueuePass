import { useState } from 'react';
import { LAYOUT_LIMITS } from '@queuepass/shared';
import { BlockFields, draftOf, readDraft, type BlockDraft } from './AddSectionForm';
import { CommitBox } from './CommitBox';
import { levelName, type EdSection, type EditorDoc } from './editor-doc';
import {
  FLOOR_NAMES,
  planDeleteSeats,
  regeneratePlan,
  rowLabelProblem,
  rowsWord,
  seatCount,
  seatLabelProblem,
  sectionNameProblem,
  seatsWord,
  totals,
  type Action,
  type Selection,
} from './editor-state';
import { LevelPicker } from './LevelPicker';
import { NumberBox } from './NumberBox';

const seatsText = (n: number): string => `${n.toLocaleString()} ${n === 1 ? 'seat' : 'seats'}`;

/** FR-013: deleting sections asks first, naming their seats. */
export function confirmDeleteSections(doc: EditorDoc, ids: readonly string[]): boolean {
  const sections = doc.sections.filter((s) => ids.includes(s.id));
  if (sections.length === 0) return false;
  const seats = sections.reduce((n, s) => n + seatCount(s), 0);
  return window.confirm(
    sections.length === 1
      ? `Delete section ${sections[0].name} and its ${seatsText(seats)}?`
      : `Delete ${sections.length} sections and their ${seatsText(seats)}?`,
  );
}

/**
 * FR-012: deletes seats of a section; when they are all its seats, asks to delete the section
 * instead (naming its seats).
 */
export function deleteSeats(
  doc: EditorDoc,
  sectionId: string,
  ids: string[],
  dispatch: (a: Action) => void,
): void {
  if (ids.length === 0) return;
  if (planDeleteSeats(doc, sectionId, ids) === 'section') {
    if (confirmDeleteSections(doc, [sectionId])) {
      dispatch({ type: 'deleteSections', ids: [sectionId] });
    }
    return;
  }
  dispatch({ type: 'deleteSeats', sectionId, ids });
}

/** The seats a rows or seats selection stands for. */
export function seatIdsOf(
  section: EdSection,
  selection: Extract<Selection, { kind: 'rows' | 'seats' }>,
): string[] {
  if (selection.kind === 'seats') return selection.ids;
  return section.rows
    .filter((r) => selection.ids.includes(r.id))
    .flatMap((r) => r.seats.map((q) => q.id));
}

/**
 * Spec 039 FR-009–FR-013, FR-026 (research R6, R7, R14; T026, T050, T051, T053): what is
 * selected. For one section: its name, its place (x, y) and angle as number boxes (a typed place
 * moves it, a typed angle turns it about its origin), its generator values with Regenerate when it
 * was generated, Duplicate section and Delete section. For rows or seats of a section: Delete
 * seats, Mark accessible or not, and the label of one row or one seat.
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
  // The section whose rows and seats are listed: the one selected, or the one its rows or seats
  // are of.
  const listed =
    one ??
    (selection.kind === 'rows' || selection.kind === 'seats'
      ? doc.sections.find((s) => s.id === selection.sectionId)
      : undefined);
  return (
    <section className="card editor-panel" aria-labelledby="editor-selection-heading">
      <h2 id="editor-selection-heading">Selection</h2>
      {selection.kind === 'none' && <p className="note">Nothing selected.</p>}
      {selection.kind === 'floor' && (
        <>
          <p>{`Floor object: ${FLOOR_NAMES[doc.floor.kind]}`}</p>
          <div className="form__actions">
            <button
              type="button"
              className="btn"
              onClick={() => dispatch({ type: 'setFloor', kind: 'NONE', at: [0, 0] })}
            >
              Delete floor object
            </button>
          </div>
        </>
      )}
      {(selection.kind === 'sections' ||
        selection.kind === 'rows' ||
        selection.kind === 'seats') && (
        <LevelPicker doc={doc} selection={selection} dispatch={dispatch} />
      )}
      {selection.kind === 'sections' && !one && (
        <>
          <p>{`${selection.ids.length} sections selected`}</p>
          <div className="form__actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (confirmDeleteSections(doc, selection.ids))
                  dispatch({ type: 'deleteSections', ids: selection.ids });
              }}
            >
              Delete sections
            </button>
          </div>
        </>
      )}
      {(selection.kind === 'rows' || selection.kind === 'seats') && (
        <PartsSelected doc={doc} selection={selection} dispatch={dispatch} />
      )}
      {one && (
        <>
          <h3>{`Section ${one.name}`}</h3>
          <p className="note">{`${levelName(doc, one.levelId)} · ${seatsText(seatCount(one))}`}</p>
          <CommitBox
            label="Section name"
            value={one.name}
            maxLength={LAYOUT_LIMITS.nameMaxLength}
            check={(name) => sectionNameProblem(doc, one.id, name)}
            onCommit={(name) => dispatch({ type: 'renameSection', id: one.id, name })}
          />
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
          <div className="form__actions">
            <button
              type="button"
              className="btn"
              onClick={() => dispatch({ type: 'duplicateSection', id: one.id })}
            >
              Duplicate section
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (confirmDeleteSections(doc, [one.id]))
                  dispatch({ type: 'deleteSections', ids: [one.id] });
              }}
            >
              Delete section
            </button>
          </div>
          {one.generator && (
            <Regenerate
              key={`${one.id} ${JSON.stringify(one.generator)}`}
              doc={doc}
              section={one}
              dispatch={dispatch}
            />
          )}
        </>
      )}
      {listed && <RowsList section={listed} selection={selection} dispatch={dispatch} />}
      {children}
    </section>
  );
}

/**
 * FR-026, R11 (T053): the chosen section's rows as a checkbox list, each row's seats opening under
 * it as another, so rows and seats are selected (then painted, deleted, relabelled or marked)
 * without the map. Checking adds to the selection, unchecking takes out.
 */
function RowsList({
  section,
  selection,
  dispatch,
}: {
  section: EdSection;
  selection: Selection;
  dispatch: (a: Action) => void;
}): React.ReactElement {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const rowsOn = new Set(selection.kind === 'rows' ? selection.ids : []);
  const seatsOn = new Set(selection.kind === 'seats' ? selection.ids : []);
  const toggleOpen = (id: string): void =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div role="group" aria-label={`Rows of section ${section.name}`} className="editor-rows">
      <h3>Rows</h3>
      <ul className="editor-rows__list">
        {section.rows.map((r) => {
          const seatsId = `editor-seats-${r.id}`;
          const isOpen = open.has(r.id);
          return (
            <li key={r.id}>
              <span className="editor-rows__row">
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Row ${r.label}`}
                    checked={rowsOn.has(r.id)}
                    onChange={() =>
                      dispatch({
                        type: 'selectRows',
                        sectionId: section.id,
                        ids: [r.id],
                        add: true,
                      })
                    }
                  />
                  {`Row ${r.label} · ${seatsText(r.seats.length)}`}
                </label>
                <button
                  type="button"
                  className="btn btn--ghost"
                  aria-label={`Seats of row ${r.label}`}
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? seatsId : undefined}
                  onClick={() => toggleOpen(r.id)}
                >
                  {isOpen ? 'Hide seats' : 'Seats'}
                </button>
              </span>
              {isOpen && (
                <div
                  id={seatsId}
                  role="group"
                  aria-label={`Seats of row ${r.label}`}
                  className="editor-rows__seats"
                >
                  {r.seats.map((q) => (
                    <label key={q.id}>
                      <input
                        type="checkbox"
                        aria-label={`Seat ${q.label}`}
                        checked={seatsOn.has(q.id)}
                        onChange={() =>
                          dispatch({
                            type: 'selectSeats',
                            sectionId: section.id,
                            ids: [q.id],
                            add: true,
                          })
                        }
                      />
                      {q.label}
                    </label>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** FR-009, R7: a generated section's values, changed and applied with Regenerate. */
function Regenerate({
  doc,
  section,
  dispatch,
}: {
  doc: EditorDoc;
  section: EdSection;
  dispatch: (a: Action) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState<BlockDraft>(() =>
    draftOf(section.generator!, section.name, section.levelId),
  );
  const [problems, setProblems] = useState<ReturnType<typeof readDraft>['problems']>({});
  const regenerate = (): void => {
    const read = readDraft(draft, doc, {
      except: section.id,
      seatsBefore: totals(doc).seats - seatCount(section),
      checkName: false,
    });
    setProblems(read.problems);
    if (Object.keys(read.problems).length > 0) return;
    const plan = regeneratePlan(doc, section.id, read.values);
    if (plan.removed > 0 || plan.handLabels) {
      const parts = [
        plan.removed > 0 ? `Regenerate removes ${seatsText(plan.removed)}.` : 'Regenerate',
        plan.handLabels ? 'Labels changed by hand are replaced.' : '',
        'Go on?',
      ].filter(Boolean);
      if (!window.confirm(parts.join(' '))) return;
    }
    dispatch({ type: 'regenerate', id: section.id, values: read.values });
  };
  return (
    <form
      className="form editor-form"
      aria-label="Generator values"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        regenerate();
      }}
    >
      <h3>Generator values</h3>
      <BlockFields doc={doc} draft={draft} onDraft={setDraft} problems={problems} />
      <div className="form__actions">
        <button type="submit" className="btn">
          Regenerate
        </button>
      </div>
    </form>
  );
}

/** "Rows A–D selected in section 101", with what can be done to them. */
function PartsSelected({
  doc,
  selection,
  dispatch,
}: {
  doc: EditorDoc;
  selection: Extract<Selection, { kind: 'rows' | 'seats' }>;
  dispatch: (a: Action) => void;
}): React.ReactElement | null {
  const section = doc.sections.find((s) => s.id === selection.sectionId);
  if (!section) return null;
  const what =
    selection.kind === 'rows'
      ? rowsWord(section, selection.ids)
      : selection.ids.length === 1
        ? seatsWord(section, selection.ids)
        : `${selection.ids.length} seats`;
  const seatIds = seatIdsOf(section, selection);
  const oneRow =
    selection.kind === 'rows' && selection.ids.length === 1
      ? section.rows.find((r) => r.id === selection.ids[0])
      : undefined;
  const oneSeat =
    selection.kind === 'seats' && selection.ids.length === 1
      ? section.rows.flatMap((r) => r.seats).find((q) => q.id === selection.ids[0])
      : undefined;
  return (
    <>
      <p>{`${what} selected in section ${section.name}`}</p>
      {oneRow && (
        <CommitBox
          label="Row label"
          value={oneRow.label}
          maxLength={LAYOUT_LIMITS.labelMaxLength}
          check={(label) => rowLabelProblem(doc, section.id, oneRow.id, label)}
          onCommit={(label) =>
            dispatch({ type: 'relabelRow', sectionId: section.id, rowId: oneRow.id, label })
          }
        />
      )}
      {oneSeat && (
        <CommitBox
          label="Seat label"
          value={oneSeat.label}
          maxLength={LAYOUT_LIMITS.labelMaxLength}
          check={(label) => seatLabelProblem(doc, section.id, oneSeat.id, label)}
          onCommit={(label) =>
            dispatch({ type: 'relabelSeat', sectionId: section.id, seatId: oneSeat.id, label })
          }
        />
      )}
      <div className="form__actions">
        <button
          type="button"
          className="btn"
          onClick={() =>
            dispatch({
              type: 'markAccessible',
              sectionId: section.id,
              ids: seatIds,
              accessible: true,
            })
          }
        >
          Mark accessible
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            dispatch({
              type: 'markAccessible',
              sectionId: section.id,
              ids: seatIds,
              accessible: false,
            })
          }
        >
          Mark not accessible
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => deleteSeats(doc, section.id, seatIds, dispatch)}
        >
          Delete seats
        </button>
      </div>
    </>
  );
}
