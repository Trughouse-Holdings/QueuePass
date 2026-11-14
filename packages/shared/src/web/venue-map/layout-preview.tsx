import type { FloorKind } from '../../seating.js';
import { outlinePath, type Point } from './map-geometry.js';

/** What a preview draws of a layout (a `LayoutDetail` has all of it). */
export interface PreviewLayout {
  name: string;
  size: { width: number; height: number };
  floorKind: FloorKind;
  floorOutline: readonly Point[] | null;
  sections: readonly {
    id: string;
    name: string;
    outline: readonly Point[];
    labelAt: readonly [number, number];
  }[];
}

/**
 * Spec 038 FR-007, research R13, R15 (T018): a small drawing of a layout, its sections in place
 * with their names around its floor object, never its seats (FR-029). One image, named for the
 * layout and its section count ("Basketball: 54 sections"); the names drawn are not read out one
 * by one. Its look comes from the shared theme's classes (Constitution VII).
 */
export function LayoutPreview({ layout }: { layout: PreviewLayout }): React.ReactElement {
  const n = layout.sections.length;
  const { width, height } = layout.size;
  // Names sized to the map, not the screen: the drawing scales as a whole.
  const fontSize = Math.max(width, height) / 50;
  return (
    <svg
      className="layout-preview"
      role="img"
      aria-label={`${layout.name}: ${n} ${n === 1 ? 'section' : 'sections'}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {layout.floorKind !== 'NONE' && layout.floorOutline && (
        <path className="layout-preview__floor" d={outlinePath(layout.floorOutline)} />
      )}
      {layout.sections.map((s) => (
        <g key={s.id}>
          <path className="layout-preview__section" d={outlinePath(s.outline)} />
          <text
            className="layout-preview__label"
            x={s.labelAt[0]}
            y={s.labelAt[1]}
            fontSize={fontSize}
            textAnchor="middle"
            dominantBaseline="central"
            aria-hidden="true"
          >
            {s.name}
          </text>
        </g>
      ))}
    </svg>
  );
}
