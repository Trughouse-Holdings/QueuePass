import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeAngle } from '@queuepass/shared';
import {
  bounds,
  centroid,
  clientToMap,
  outlinePath,
  usePanZoom,
  type Bounds,
  type View,
} from '@queuepass/shared/web';
import { farthest, levelName, type EditorDoc, type Place } from './editor-doc';
import { Guide } from './Guide';
import { seatCount, type Action, type Selection } from './editor-state';
import { SectionSeatsView, seatsInBox } from './SectionSeatsView';
import { confirmDeleteSections, deleteSeats, seatIdsOf } from './SelectionPanel';

/** An empty map shows at least this much, in map units (seats are 2 apart). */
const MIN_WIDTH = 300;
const MIN_HEIGHT = 200;
/** The map grows in steps of this, so a small move does not reset the view. */
const GROW_STEP = 50;
/** A press that moves less than this many pixels is a click, not a drag. */
const DRAG_SLOP = 3;

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
const degreesOf = (from: Place, to: Place): number =>
  (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
const tenth = (n: number): number => Math.round(n * 10) / 10;

type Corner = 'nw' | 'ne' | 'se' | 'sw';
const CORNERS: Corner[] = ['nw', 'ne', 'se', 'sw'];
const cornerAt = (b: Bounds, c: Corner): Place => [
  c === 'nw' || c === 'sw' ? b.x : b.x + b.width,
  c === 'nw' || c === 'ne' ? b.y : b.y + b.height,
];
const OPPOSITE: Record<Corner, Corner> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };

/** A drag under way: what it moves, from where. */
type Drag =
  | { kind: 'move'; ids: string[]; from: Place; client: Place; moved: boolean }
  | { kind: 'turn'; ids: string[]; center: Place; start: number }
  | { kind: 'floor'; from: Place; client: Place; moved: boolean }
  | { kind: 'corner'; fixed: Place }
  | { kind: 'box'; from: Place; add: boolean };

/** What the drag shows until it is let go: then it is one action (R11). */
type Live =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'turn'; degrees: number }
  | { kind: 'floor'; dx: number; dy: number }
  | { kind: 'corner'; box: Bounds }
  | { kind: 'box'; from: Place; to: Place }
  | null;

export interface CanvasProps {
  doc: EditorDoc;
  selection: Selection;
  readOnly: boolean;
  dispatch: (a: Action) => void;
  /** The section zoomed into, its seats drawn (R2), or none. */
  zoomed?: string | null;
  /** Sections drawn with a warning outline (overlaps, R15). */
  warned?: ReadonlySet<string>;
  /** Hears the middle of the visible map, where a new section goes (FR-007). */
  centerRef?: React.MutableRefObject<Place>;
}

/**
 * Spec 039 research R2, R11 (T023, T033): the editor's map, drawn with the shared map's shapes
 * (`outlinePath`, the floor object, sections in their level's color with their names) in an SVG,
 * panned and zoomed by the shared `usePanZoom`. Click selects a section, Shift-click adds or
 * removes one; dragging a selected section moves the selection, the round handle above it turns
 * it (1°, Shift 15°), each about its own origin; the floor object is dragged and resized by its
 * corners. While dragging only an SVG transform changes; letting go is one action, one Undo step.
 * Each section is a focusable button named with its level and seats, so color is never the only
 * cue (FR-018, FR-027). With the map focused, the arrow keys move the selection (Shift 10), `[`
 * and `]` turn it (Shift 15°), Escape clears it; without a selection they pan and zoom.
 */
export function EditorCanvas({
  doc,
  selection,
  readOnly,
  dispatch,
  zoomed = null,
  warned,
  centerRef,
}: CanvasProps): React.ReactElement {
  const fit = useMemo(() => mapFit(doc), [doc]);
  const pz = usePanZoom(fit);
  const svg = useRef<SVGSVGElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [live, setLiveState] = useState<Live>(null);
  const liveRef = useRef<Live>(null);
  const setLive = (l: Live): void => {
    liveRef.current = l;
    setLiveState(l);
  };
  const [boxSelect, setBoxSelect] = useState(false);
  if (centerRef) centerRef.current = viewCenter(pz.view);
  const zoomSection = zoomed ? doc.sections.find((s) => s.id === zoomed) : undefined;

  // Zooming into a section shows it whole (the shared map's animated zoom); out, the whole map.
  const { zoomTo, fit: fitAll } = pz;
  const zoomOutline = useRef(zoomSection?.outline);
  zoomOutline.current = zoomSection?.outline;
  useEffect(() => {
    if (zoomed && zoomOutline.current) zoomTo(bounds(zoomOutline.current), 4);
    else fitAll();
  }, [zoomed, zoomTo, fitAll]);

  // Walk feedback (2026-11-14): a floor object just chosen (it is put down in the middle of the
  // view and selected) is shown whole, with room around it; opening a layout never moves the view.
  const floorKind = doc.floor.kind;
  const floorOutline = useRef(doc.floor.outline);
  floorOutline.current = doc.floor.outline;
  const floorChosen = selection.kind === 'floor';
  const shownKind = useRef(floorKind);
  useEffect(() => {
    if (floorKind === shownKind.current) return;
    shownKind.current = floorKind;
    const outline = floorOutline.current;
    if (floorKind === 'NONE' || !outline || !floorChosen) return;
    const b = bounds(outline);
    zoomTo(b, Math.max(b.width, b.height) / 4);
  }, [floorKind, floorChosen, zoomTo]);

  const selectedIds = selection.kind === 'sections' ? selection.ids : [];
  const selected = new Set(selectedIds);
  const colorOf = new Map(doc.levels.map((l) => [l.id, l.color]));
  const fontSize = Math.max(fit.width, fit.height) / 60;
  const handleR = Math.max(1.5, pz.view.width / 100);

  /** A pointer's place on the map; jsdom lays nothing out, so then its view is its box. */
  const toMap = (e: { clientX: number; clientY: number }): Place => {
    const r = svg.current?.getBoundingClientRect();
    const rect =
      r && r.width > 0 && r.height > 0
        ? r
        : { left: 0, top: 0, width: pz.view.width, height: pz.view.height };
    return clientToMap(pz.view, rect, [e.clientX, e.clientY]);
  };
  const capture = (e: React.PointerEvent): void => {
    svg.current?.setPointerCapture?.(e.pointerId);
  };

  const pressSection = (e: React.PointerEvent, id: string): void => {
    e.stopPropagation();
    if (e.shiftKey) {
      dispatch({ type: 'toggleSection', id });
      return;
    }
    const ids = selected.has(id) ? selectedIds : [id];
    if (!selected.has(id)) dispatch({ type: 'selectSections', ids });
    if (readOnly) return;
    drag.current = {
      kind: 'move',
      ids,
      from: toMap(e),
      client: [e.clientX, e.clientY],
      moved: false,
    };
    // Not captured yet: a click, or a double-click that zooms in, must still reach the section.
    // The pointer is taken once the drag moves (onPointerMove), as the shared pan does.
  };

  const pressFloor = (e: React.PointerEvent): void => {
    if (readOnly) return;
    e.stopPropagation();
    dispatch({ type: 'selectFloor' });
    drag.current = { kind: 'floor', from: toMap(e), client: [e.clientX, e.clientY], moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (!d) {
      pz.onPointerMove(e);
      return;
    }
    const at = toMap(e);
    if (d.kind === 'move' || d.kind === 'floor') {
      if (!d.moved && Math.hypot(e.clientX - d.client[0], e.clientY - d.client[1]) < DRAG_SLOP)
        return;
      if (!d.moved) capture(e);
      d.moved = true;
      setLive({ kind: d.kind, dx: at[0] - d.from[0], dy: at[1] - d.from[1] });
    } else if (d.kind === 'turn') {
      const step = e.shiftKey ? 15 : 1;
      const raw = normalizeAngle(degreesOf(d.center, at) - d.start);
      setLive({ kind: 'turn', degrees: Math.round(raw / step) * step });
    } else if (d.kind === 'box') {
      setLive({ kind: 'box', from: d.from, to: at });
    } else {
      setLive({
        kind: 'corner',
        box: {
          x: Math.min(d.fixed[0], at[0]),
          y: Math.min(d.fixed[1], at[1]),
          width: Math.abs(at[0] - d.fixed[0]),
          height: Math.abs(at[1] - d.fixed[1]),
        },
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>): void => {
    pz.onPointerUp(e);
    const d = drag.current;
    drag.current = null;
    const shown = liveRef.current;
    setLive(null);
    if (!d || !shown) return;
    if (d.kind === 'move' && shown.kind === 'move') {
      dispatch({ type: 'moveSections', ids: d.ids, dx: tenth(shown.dx), dy: tenth(shown.dy) });
    } else if (d.kind === 'floor' && shown.kind === 'floor') {
      dispatch({ type: 'moveFloor', dx: tenth(shown.dx), dy: tenth(shown.dy) });
    } else if (d.kind === 'turn' && shown.kind === 'turn') {
      dispatch({ type: 'turnSections', ids: d.ids, degrees: shown.degrees });
    } else if (d.kind === 'box' && shown.kind === 'box' && zoomSection) {
      dispatch({
        type: 'selectSeats',
        sectionId: zoomSection.id,
        ids: seatsInBox(zoomSection, shown.from, shown.to),
        add: d.add,
      });
    } else if (d.kind === 'corner' && shown.kind === 'corner') {
      const b = shown.box;
      dispatch({
        type: 'resizeFloor',
        to: { x: tenth(b.x), y: tenth(b.y), width: tenth(b.width), height: tenth(b.height) },
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>): void => {
    // The map itself, or a section on it (review M3): a keyboard user who chose a section with
    // Space moves and turns it from there.
    const onSection = (e.target as Element).closest?.('.editor-map__section') != null;
    if (e.target !== e.currentTarget && !onSection) return;
    if (e.key === 'Escape') {
      dispatch({ type: 'clearSelection' });
      return;
    }
    // FR-026: Delete (or Backspace) deletes the selection after asking.
    if (!readOnly && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      if (selection.kind === 'sections') {
        if (confirmDeleteSections(doc, selection.ids))
          dispatch({ type: 'deleteSections', ids: selection.ids });
      } else if (selection.kind === 'rows' || selection.kind === 'seats') {
        const section = doc.sections.find((x) => x.id === selection.sectionId);
        if (section) deleteSeats(doc, section.id, seatIdsOf(section, selection), dispatch);
      }
      return;
    }
    if (!readOnly && !zoomSection && selectedIds.length > 0) {
      const step = e.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = moves[e.key];
      if (move) {
        e.preventDefault();
        dispatch({ type: 'moveSections', ids: selectedIds, dx: move[0], dy: move[1] });
        return;
      }
      // `[` and `]` (`{` and `}` with Shift on most keyboards) turn the selection.
      const turn = ({ '[': -1, ']': 1, '{': -1, '}': 1 } as Record<string, number>)[e.key];
      if (turn) {
        e.preventDefault();
        dispatch({ type: 'turnSections', ids: selectedIds, degrees: turn * (e.shiftKey ? 15 : 1) });
        return;
      }
    }
    pz.onKeyDown(e);
  };

  // The selection's box, and the turn handle above it.
  const selectedPoints = doc.sections.filter((s) => selected.has(s.id)).flatMap((s) => s.outline);
  const box = selectedPoints.length > 0 && !zoomSection ? bounds(selectedPoints) : null;
  const boxCenter: Place | null = box ? [box.x + box.width / 2, box.y + box.height / 2] : null;
  const handleAt: Place | null =
    box && boxCenter ? [boxCenter[0], box.y - 1 - Math.max(4, pz.view.height / 15)] : null;
  const groupTransform = (origin: Place): string | undefined => {
    if (live?.kind === 'move') return `translate(${live.dx} ${live.dy})`;
    if (live?.kind === 'turn') return `rotate(${live.degrees} ${origin[0]} ${origin[1]})`;
    return undefined;
  };

  // The floor, as the drag shows it.
  let floor = doc.floor.outline;
  if (floor && live?.kind === 'corner') {
    const from = bounds(floor);
    const to = live.box;
    floor = floor.map((p): Place => [
      to.x + ((p[0] - from.x) * to.width) / (from.width || 1),
      to.y + ((p[1] - from.y) * to.height) / (from.height || 1),
    ]);
  }
  const floorBox = floor ? bounds(floor) : null;
  const floorShift = live?.kind === 'floor' ? `translate(${live.dx} ${live.dy})` : undefined;
  const n = doc.sections.length;

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
        {zoomSection && (
          <>
            <button
              type="button"
              className="btn"
              aria-pressed={boxSelect}
              onClick={() => setBoxSelect((b) => !b)}
            >
              Box select
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => dispatch({ type: 'zoom', id: null })}
            >
              Back to layout
            </button>
          </>
        )}
      </div>
      {!readOnly && <Guide doc={doc} selection={selection} zoomed={zoomSection !== undefined} />}
      <svg
        ref={(el) => {
          svg.current = el;
          pz.ref(el);
        }}
        className="editor-map"
        role="application"
        aria-label={`Layout map: ${n} ${n === 1 ? 'section' : 'sections'}`}
        aria-roledescription="layout map"
        tabIndex={0}
        viewBox={pz.viewBox}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={(e) => {
          // Review B3: with Box select on in a zoomed section, a press anywhere (the section's
          // own outline included) not taken by a seat or a row label starts the box, not a pan.
          if (zoomSection && boxSelect) {
            drag.current = { kind: 'box', from: toMap(e), add: e.shiftKey };
            capture(e);
            return;
          }
          pz.onPointerDown(e);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <rect
          className="editor-map__bg"
          x={fit.x}
          y={fit.y}
          width={fit.width}
          height={fit.height}
          onClick={() => {
            if (!pz.dragged()) dispatch({ type: 'clearSelection' });
          }}
        />
        {floor && (
          <path
            className={`editor-map__floor${selection.kind === 'floor' ? ' editor-map__floor--selected' : ''}`}
            d={outlinePath(floor)}
            transform={floorShift}
            onPointerDown={pressFloor}
          />
        )}
        {zoomSection &&
          doc.sections.map((s) =>
            s.id === zoomSection.id ? (
              <path
                key={s.id}
                className="editor-map__current"
                d={outlinePath(s.outline)}
                aria-hidden="true"
              />
            ) : (
              <path
                key={s.id}
                className={`editor-map__faded venue-map--${colorOf.get(s.levelId) ?? 'violet'}`}
                d={outlinePath(s.outline)}
                aria-hidden="true"
              />
            ),
          )}
        {zoomSection && (
          <SectionSeatsView
            doc={doc}
            section={zoomSection}
            selection={selection}
            dispatch={dispatch}
          />
        )}
        {!zoomSection &&
          doc.sections.map((s) => {
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
                transform={isSelected ? groupTransform(s.origin) : undefined}
                onPointerDown={(e) => pressSection(e, s.id)}
                onDoubleClick={() => dispatch({ type: 'zoom', id: s.id })}
                onKeyDown={(e) => {
                  if (e.key !== ' ' && e.key !== 'Enter') return;
                  e.preventDefault();
                  e.stopPropagation();
                  // R11: Enter zooms into the section, Space selects it (Shift adds).
                  if (e.key === 'Enter') {
                    dispatch({ type: 'zoom', id: s.id });
                    return;
                  }
                  dispatch(
                    e.shiftKey
                      ? { type: 'toggleSection', id: s.id }
                      : { type: 'selectSections', ids: [s.id] },
                  );
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
        {box && (
          <rect
            className="editor-map__selection"
            x={box.x - 1}
            y={box.y - 1}
            width={box.width + 2}
            height={box.height + 2}
            transform={live?.kind === 'move' ? `translate(${live.dx} ${live.dy})` : undefined}
            aria-hidden="true"
          />
        )}
        {!readOnly && box && boxCenter && handleAt && (
          <g aria-hidden="true">
            <line
              className="editor-map__turn-line"
              x1={boxCenter[0]}
              y1={box.y - 1}
              x2={handleAt[0]}
              y2={handleAt[1]}
            />
            <circle
              className="editor-map__turn"
              cx={handleAt[0]}
              cy={handleAt[1]}
              r={handleR}
              onPointerDown={(e) => {
                e.stopPropagation();
                drag.current = {
                  kind: 'turn',
                  ids: selectedIds,
                  center: boxCenter,
                  start: degreesOf(boxCenter, toMap(e)),
                };
                capture(e);
              }}
            />
          </g>
        )}
        {live?.kind === 'box' && (
          <rect
            className="editor-map__box"
            x={Math.min(live.from[0], live.to[0])}
            y={Math.min(live.from[1], live.to[1])}
            width={Math.abs(live.to[0] - live.from[0])}
            height={Math.abs(live.to[1] - live.from[1])}
            aria-hidden="true"
          />
        )}
        {!readOnly && selection.kind === 'floor' && floorBox && !floorShift && (
          <g aria-hidden="true">
            {CORNERS.map((c) => {
              const [x, y] = cornerAt(floorBox, c);
              return (
                <rect
                  key={c}
                  className="editor-map__corner"
                  data-corner={c}
                  x={x - handleR}
                  y={y - handleR}
                  width={handleR * 2}
                  height={handleR * 2}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    drag.current = { kind: 'corner', fixed: cornerAt(floorBox, OPPOSITE[c]) };
                    capture(e);
                  }}
                />
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}
