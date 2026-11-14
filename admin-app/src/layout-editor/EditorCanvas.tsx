import { useMemo, useRef } from 'react';
import { bounds, centroid, outlinePath, usePanZoom, type View } from '@queuepass/shared/web';
import { farthest, levelName, type EditorDoc, type Place } from './editor-doc';
import { seatCount, type Action, type Selection } from './editor-state';

/** An empty map shows at least this much, in map units (seats are 2 apart). */
const MIN_WIDTH = 300;
const MIN_HEIGHT = 200;
/** The map grows in steps of this, so a small move does not reset the view. */
const GROW_STEP = 50;

/**
 * FR-005: the whole map, from 0, at least 300 × 200, growing in steps of 50 to keep every
 * section and the floor object inside it with room around them.
 */
export function mapFit(doc: EditorDoc): View {
  const [x, y] = farthest(doc);
  const up = (n: number, min: number): number =>
    Math.max(min, Math.ceil((n + 20) / GROW_STEP) * GROW_STEP);
  return { x: 0, y: 0, width: up(x, MIN_WIDTH), height: up(y, MIN_HEIGHT) };
}

const viewCenter = (v: View): Place => [v.x + v.width / 2, v.y + v.height / 2];

export interface CanvasProps {
  doc: EditorDoc;
  selection: Selection;
  readOnly: boolean;
  dispatch: (a: Action) => void;
  /** Sections drawn with a warning outline (overlaps, R15). */
  warned?: ReadonlySet<string>;
  /** Hears the middle of the visible map, where a new section goes (FR-007). */
  centerRef?: React.MutableRefObject<Place>;
}

/**
 * Spec 039 research R2, R11 (T023, T033): the editor's map, drawn with the shared map's shapes
 * (`outlinePath`, the floor object, sections in their level's color with their names) in an SVG,
 * panned and zoomed by the shared `usePanZoom`. Click selects a section, Shift-click adds or
 * removes one; each section is a focusable button named with its level and seats, so color is
 * never the only cue (FR-018, FR-027).
 */
export function EditorCanvas({
  doc,
  selection,
  readOnly,
  dispatch,
  warned,
  centerRef,
}: CanvasProps): React.ReactElement {
  const fit = useMemo(() => mapFit(doc), [doc]);
  const pz = usePanZoom(fit);
  const svg = useRef<SVGSVGElement | null>(null);
  if (centerRef) centerRef.current = viewCenter(pz.view);

  const selected = new Set(selection.kind === 'sections' ? selection.ids : []);
  const colorOf = new Map(doc.levels.map((l) => [l.id, l.color]));
  const fontSize = Math.max(fit.width, fit.height) / 60;

  const choose = (id: string, add: boolean): void => {
    dispatch(add ? { type: 'toggleSection', id } : { type: 'selectSections', ids: [id] });
  };

  return (
    <div className="editor-map-wrap">
      <div className="editor-map__toolbar" role="group" aria-label="Zoom">
        <button type="button" className="btn" onClick={pz.zoomIn}>
          Zoom in
        </button>
        <button type="button" className="btn" onClick={pz.zoomOut}>
          Zoom out
        </button>
        <button type="button" className="btn" onClick={pz.fit}>
          Fit
        </button>
      </div>
      <svg
        ref={(el) => {
          svg.current = el;
          pz.ref(el);
        }}
        className="editor-map"
        role="application"
        aria-label={`Layout map: ${doc.sections.length} ${doc.sections.length === 1 ? 'section' : 'sections'}`}
        tabIndex={0}
        viewBox={pz.viewBox}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={pz.onPointerDown}
        onPointerMove={pz.onPointerMove}
        onPointerUp={pz.onPointerUp}
        onPointerCancel={pz.onPointerUp}
        onKeyDown={pz.onKeyDown}
      >
        <rect
          className="editor-map__bg"
          x={fit.x}
          y={fit.y}
          width={fit.width}
          height={fit.height}
        />
        {doc.floor.outline && (
          <path
            className={`editor-map__floor${selection.kind === 'floor' ? ' editor-map__floor--selected' : ''}`}
            d={outlinePath(doc.floor.outline)}
            onPointerDown={(e) => {
              if (readOnly) return;
              e.stopPropagation();
              dispatch({ type: 'selectFloor' });
            }}
          />
        )}
        {doc.sections.map((s) => {
          const seats = seatCount(s);
          const [lx, ly] = centroid(s.outline);
          const isSelected = selected.has(s.id);
          return (
            <g
              key={s.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={`Section ${s.name}, ${levelName(doc, s.levelId)}, ${seats} ${seats === 1 ? 'seat' : 'seats'}`}
              className={`editor-map__section${isSelected ? ' editor-map__section--selected' : ''}${
                warned?.has(s.id) ? ' editor-map__section--warn' : ''
              }`}
              onPointerDown={(e) => {
                e.stopPropagation();
                choose(s.id, e.shiftKey);
              }}
              onKeyDown={(e) => {
                if (e.key !== ' ' && e.key !== 'Enter') return;
                e.preventDefault();
                e.stopPropagation();
                choose(s.id, e.shiftKey);
              }}
            >
              <path
                className={`venue-map--${colorOf.get(s.levelId) ?? 'violet'}`}
                d={outlinePath(s.outline)}
              />
              <text
                className="editor-map__label"
                x={lx}
                y={ly}
                fontSize={fontSize}
                textAnchor="middle"
                dominantBaseline="central"
                aria-hidden="true"
              >
                {s.name}
              </text>
            </g>
          );
        })}
        {selection.kind === 'sections' && <SelectionBox doc={doc} ids={selection.ids} />}
      </svg>
    </div>
  );
}

/** A dashed rectangle around the selected sections. */
function SelectionBox({ doc, ids }: { doc: EditorDoc; ids: string[] }): React.ReactElement | null {
  const points = doc.sections.filter((s) => ids.includes(s.id)).flatMap((s) => s.outline);
  if (points.length === 0) return null;
  const b = bounds(points);
  return (
    <rect
      className="editor-map__selection"
      x={b.x - 1}
      y={b.y - 1}
      width={b.width + 2}
      height={b.height + 2}
      aria-hidden="true"
    />
  );
}
