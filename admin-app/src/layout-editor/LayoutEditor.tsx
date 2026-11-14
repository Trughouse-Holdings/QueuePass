import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { LAYOUT_LIMITS, type FloorKind, type LayoutDrawing } from '@queuepass/shared';
import { LayoutPreview, centroid } from '@queuepass/shared/web';
import type { ApiError } from '../api/client';
import { createLayoutDrawing, getLayoutDrawing, saveLayoutDrawing } from '../api/layouts';
import { ErrorBanner } from '../components/ErrorBanner';
import { EditorCanvas } from './EditorCanvas';
import { emptyDoc, fromDrawing, mapSize, toInput, type EditorDoc, type Place } from './editor-doc';
import { FLOOR_NAMES, currentDoc, initState, isDirty, reduce } from './editor-state';
import { LevelsPanel } from './LevelsPanel';
import { SaveBar, asApiError } from './SaveBar';
import { SectionsPanel } from './SectionsPanel';
import { SelectionPanel } from './SelectionPanel';
import { PHONE, useMediaQuery } from './use-media';

/** What the editor knows of the saved layout beside its document (R9). */
interface Meta {
  revision: number | null;
  locked: boolean;
  lockedBy: { id: string; name: string }[];
}

const metaOf = (d: LayoutDrawing): Meta => ({
  revision: d.revision,
  locked: d.locked,
  lockedBy: d.lockedBy,
});

/** R13: the question before unsaved changes are thrown away. */
export const LEAVE = 'Leave without saving? Your changes will be lost.';

/** "A", "A and B", "A, B and C". */
const listed = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** The route's element: one editor per layout, started afresh when the layout changes. */
export function LayoutEditorPage(): React.ReactElement {
  const { id = '', layoutId } = useParams();
  return <LayoutEditor key={layoutId ?? 'new'} venueId={id} layoutId={layoutId ?? null} />;
}

/** The layout's drawing for the shared preview (phone width). */
const previewOf = (doc: EditorDoc) => ({
  name: doc.name || 'New layout',
  size: mapSize(doc),
  floorKind: doc.floor.kind,
  floorOutline: doc.floor.outline,
  sections: doc.sections.map((s) => ({
    id: s.id,
    name: s.name,
    outline: s.outline,
    labelAt: centroid(s.outline),
  })),
});

/**
 * Spec 039 (FR-001–FR-005, FR-019; research R13, R14; T023): the layout editor, full page. It
 * reads the whole layout (`getLayoutDrawing`) or starts a new one, and holds it in one document
 * (`editor-state.ts`) until Save sends it whole. A toolbar (name, Undo, Redo, Save), the map, and
 * a side column of panels; a polite status line announces every change (FR-027). A locked layout
 * and a phone-width screen are read-only (FR-002, FR-004).
 */
export function LayoutEditor({
  venueId,
  layoutId,
}: {
  venueId: string;
  layoutId: string | null;
}): React.ReactElement {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reduce, undefined, () => initState(emptyDoc()));
  const [loading, setLoading] = useState<boolean>(layoutId !== null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [meta, setMeta] = useState<Meta>({ revision: null, locked: false, lockedBy: [] });
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const narrow = useMediaQuery(PHONE);
  const centerRef = useRef<Place>([150, 100]);
  const [warned, setWarned] = useState<Set<string>>(() => new Set());
  const nameId = useId();
  const nameProblemId = useId();

  const doc = currentDoc(state);
  const dirty = isDirty(state);

  // FR-001 US1-7, R13: leaving with unsaved changes asks first, by any link, back or forward;
  // a reload or a closed tab, through the browser's own question.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(LEAVE)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return undefined;
    const hold = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      // Older browsers ask only when a return value is set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', hold);
    return () => window.removeEventListener('beforeunload', hold);
  }, [dirty]);

  useEffect(() => {
    if (!layoutId) return undefined;
    let live = true;
    getLayoutDrawing(layoutId).then(
      (d) => {
        if (!live) return;
        dispatch({ type: 'load', doc: fromDrawing(d) });
        setMeta(metaOf(d));
        setLoading(false);
      },
      (err: unknown) => {
        if (!live) return;
        setLoadError(asApiError(err));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [layoutId]);

  const editPath = (id: string): string => `/locations/${venueId}/layouts/${id}/edit`;

  /** Saves the document whole (R3), then reads it back for the ids and revision it now has. */
  const save = async (): Promise<void> => {
    const sent = currentDoc(state);
    if (layoutId) {
      await saveLayoutDrawing(layoutId, toInput(sent, meta.revision));
      try {
        const d = await getLayoutDrawing(layoutId);
        dispatch({ type: 'saved', doc: fromDrawing(d) });
        setMeta(metaOf(d));
      } catch {
        // Saved, but not read back: the next save may give new seats new ids, which is safe.
        dispatch({ type: 'saved' });
        setMeta((m) => ({ ...m, revision: (m.revision ?? 0) + 1 }));
      }
      return;
    }
    const made = await createLayoutDrawing(venueId, toInput(sent, null));
    dispatch({ type: 'saved' });
    // Saved: the move to the new layout's route is not leaving unsaved work.
    dirtyRef.current = false;
    navigate(editPath(made.id), { replace: true });
  };

  if (loading) return <p className="loading">Loading the layout…</p>;
  if (loadError) {
    return (
      <div className="layout-editor">
        <ErrorBanner error={loadError} title="Could not open the layout" />
        <Link to={`/locations/${venueId}`}>Back to the venue</Link>
      </div>
    );
  }

  const title = layoutId
    ? meta.locked
      ? doc.name
      : `Edit layout: ${state.saved.name}`
    : 'New layout';
  const back = (
    <Link to={`/locations/${venueId}`} className="tap">
      Back to the venue
    </Link>
  );

  if (narrow) {
    return (
      <div className="layout-editor">
        <h1 className="page-title">{title}</h1>
        <LayoutPreview layout={previewOf(doc)} />
        <p className="note">Editing a layout needs a wider screen.</p>
        {back}
      </div>
    );
  }

  if (meta.locked) {
    return (
      <div className="layout-editor">
        <div className="layout-editor__head">
          <h1 className="page-title">{title}</h1>
          {back}
        </div>
        <p className="note">
          {`Locked: seats are sold or held at ${listed(meta.lockedBy.map((e) => e.name))}`}
        </p>
        <div className="layout-editor__body">
          <EditorCanvas doc={doc} selection={state.selection} readOnly dispatch={dispatch} />
          <div className="layout-editor__side">
            <LevelsPanel doc={doc} />
          </div>
        </div>
      </div>
    );
  }

  const firstLevel = doc.levels[0]?.id ?? '';

  return (
    <div className="layout-editor">
      <div className="layout-editor__head">
        <h1 className="page-title">{title}</h1>
        {back}
      </div>
      <div className="layout-editor__toolbar">
        <div className="field layout-editor__name">
          <label htmlFor={nameId}>Layout name</label>
          <input
            id={nameId}
            value={doc.name}
            maxLength={LAYOUT_LIMITS.nameMaxLength}
            aria-describedby={nameProblem ? nameProblemId : undefined}
            aria-invalid={nameProblem ? true : undefined}
            onChange={(e) => {
              setNameProblem(null);
              dispatch({ type: 'rename', name: e.target.value });
            }}
          />
          {nameProblem && (
            <span id={nameProblemId} className="editor-field-error">
              {nameProblem}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn"
          disabled={state.cursor === 0}
          onClick={() => dispatch({ type: 'undo' })}
        >
          Undo
        </button>
        <button
          type="button"
          className="btn"
          disabled={state.cursor === state.history.length - 1}
          onClick={() => dispatch({ type: 'redo' })}
        >
          Redo
        </button>
        <SaveBar
          doc={doc}
          dirty={dirty}
          onSave={save}
          onSelectSection={(i) => {
            const s = doc.sections[i];
            if (s) dispatch({ type: 'selectSections', ids: [s.id] });
          }}
          onNameProblem={setNameProblem}
          onWarned={setWarned}
        />
      </div>
      <p role="status" aria-live="polite" className="layout-editor__status">
        {state.message}
      </p>
      <div className="layout-editor__body">
        <EditorCanvas
          doc={doc}
          selection={state.selection}
          readOnly={false}
          dispatch={dispatch}
          centerRef={centerRef}
          warned={warned}
        />
        <div className="layout-editor__side">
          <FloorField
            kind={doc.floor.kind}
            onKind={(kind) => dispatch({ type: 'setFloor', kind, at: centerRef.current })}
          />
          <LevelsPanel doc={doc} />
          <SectionsPanel
            doc={doc}
            selection={state.selection}
            levelId={firstLevel}
            onSelect={(id, add) =>
              dispatch(add ? { type: 'toggleSection', id } : { type: 'selectSections', ids: [id] })
            }
            onAdd={(name, values, levelId) =>
              dispatch({ type: 'addSection', name, values, levelId, at: centerRef.current })
            }
          />
          <SelectionPanel doc={doc} selection={state.selection} dispatch={dispatch} />
        </div>
      </div>
    </div>
  );
}

/** FR-005: the floor object: court, end stage, center stage, ring, or none. */
function FloorField({
  kind,
  onKind,
}: {
  kind: FloorKind;
  onKind: (kind: FloorKind) => void;
}): React.ReactElement {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Floor object</label>
      <select id={id} value={kind} onChange={(e) => onKind(e.target.value as FloorKind)}>
        {(Object.keys(FLOOR_NAMES) as FloorKind[]).map((k) => (
          <option key={k} value={k}>
            {FLOOR_NAMES[k]}
          </option>
        ))}
      </select>
    </div>
  );
}
