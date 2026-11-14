import { LAYOUT_LIMITS, LEVEL_COLORS, type FloorKind, type LevelColor } from '@queuepass/shared';
import { expandRun, type Point } from './seat-runs';

/**
 * Spec 038 FR-004, research R5 (T014): a layout file checked as a whole before anything is saved.
 * Every problem is listed with where it is (`path`, from the request body, so `file.…`) and a
 * message that names the place as people read it ("Section 104, row F: seat 7 appears twice").
 * The first `MAX_PROBLEMS` are kept; `more` counts the rest.
 */

export const MAX_PROBLEMS = 50;

export interface Problem {
  path: string;
  message: string;
}

/** A seat to save: its number is its place in its row (from 1), in the order the file lists. */
export interface CheckedSeat {
  number: number;
  label: string;
  at: Point;
  levelKey: string | null;
  accessible: boolean;
}

/** A row to save: its number is its place in its section (from 1, front first). */
export interface CheckedRow {
  number: number;
  label: string;
  levelKey: string | null;
  seats: CheckedSeat[];
}

export interface CheckedSection {
  name: string;
  levelKey: string;
  outline: Point[];
  labelAt: Point;
  rows: CheckedRow[];
}

export interface CheckedLevel {
  key: string;
  name: string;
  rank: number;
  color: LevelColor;
}

/** A layout file that passed every check, ready to save. */
export interface CheckedLayout {
  name: string;
  floorKind: FloorKind;
  floorOutline: Point[] | null;
  width: number;
  height: number;
  levels: CheckedLevel[];
  sections: CheckedSection[];
  seatCount: number;
}

export type LayoutFileResult =
  { ok: true; layout: CheckedLayout } | { ok: false; problems: Problem[]; more: number };

const FLOOR_KINDS: readonly FloorKind[] = ['COURT', 'END_STAGE', 'CENTER_STAGE', 'RING', 'NONE'];
const KEY = /^[a-z0-9-]{1,30}$/;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const count = (n: number): string => n.toLocaleString('en-US');
const fold = (s: string): string => s.toLowerCase();
const show = (n: number): string => String(Math.round(n * 1000) / 1000);

/**
 * Spec 038 research R5: a polygon's centroid (its area's center), where a section's name is drawn
 * when the file gives no `labelAt`; the average of its points when it has no area.
 */
export function centroid(points: Point[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    return [
      points.reduce((s, p) => s + p[0], 0) / points.length,
      points.reduce((s, p) => s + p[1], 0) / points.length,
    ];
  }
  return [cx / (3 * area), cy / (3 * area)];
}

/** Checks `file` (the request's `file`, any JSON) as a layout file, format 1. */
export function checkLayoutFile(file: unknown): LayoutFileResult {
  const problems: Problem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });
  const done = (): LayoutFileResult => ({
    ok: false,
    problems: problems.slice(0, MAX_PROBLEMS),
    more: Math.max(0, problems.length - MAX_PROBLEMS),
  });

  if (!isObject(file)) {
    add('file', 'The layout file must be a JSON object.');
    return done();
  }

  if (file.format !== 1) add('file.format', 'The layout file must say "format": 1.');

  const name = checkName(file.name, 'file.name', "The layout's name", add);

  // The map's size first: every place is checked against it.
  let width = 0;
  let height = 0;
  const size = file.size;
  if (!isObject(size)) {
    add('file.size', 'The layout file needs a "size" with a width and a height.');
  } else {
    for (const side of ['width', 'height'] as const) {
      const v = size[side];
      if (!isInt(v) || v < 1 || v > LAYOUT_LIMITS.maxMapUnits) {
        add(
          `file.size.${side}`,
          `The map's ${side} must be a whole number from 1 to ${count(LAYOUT_LIMITS.maxMapUnits)}.`,
        );
      } else if (side === 'width') width = v;
      else height = v;
    }
  }
  const sized = width > 0 && height > 0;
  const mapText = `the map (${width} × ${height})`;

  /** A point `[x, y]` inside the map, or null with a problem. */
  const point = (v: unknown, path: string, what: string): Point | null => {
    if (
      !Array.isArray(v) ||
      v.length !== 2 ||
      typeof v[0] !== 'number' ||
      typeof v[1] !== 'number' ||
      !Number.isFinite(v[0]) ||
      !Number.isFinite(v[1])
    ) {
      add(path, `${what} must be a point [x, y].`);
      return null;
    }
    const p: Point = [v[0], v[1]];
    if (sized && (p[0] < 0 || p[1] < 0 || p[0] > width || p[1] > height)) {
      add(path, `${what} (${show(p[0])}, ${show(p[1])}) is outside ${mapText}`);
      return null;
    }
    return p;
  };

  /** An outline of 3 to 64 points inside the map. */
  const outline = (v: unknown, path: string, place: string): Point[] | null => {
    if (!Array.isArray(v) || v.length < 3) {
      add(path, `${place}: the outline needs at least 3 points.`);
      return null;
    }
    if (v.length > LAYOUT_LIMITS.maxOutlinePoints) {
      add(
        path,
        `${place}: the outline has ${v.length} points; at most ${LAYOUT_LIMITS.maxOutlinePoints}`,
      );
      return null;
    }
    const points = v.map((p, i) => point(p, `${path}[${i}]`, `${place}: outline point ${i + 1}`));
    return points.every((p) => p !== null) ? (points as Point[]) : null;
  };

  // The floor object: an outline exactly when it is not NONE.
  let floorKind: FloorKind = 'NONE';
  let floorOutline: Point[] | null = null;
  const floor = file.floor;
  if (!isObject(floor)) {
    add('file.floor', 'The layout file needs a "floor" with its "kind".');
  } else if (!FLOOR_KINDS.includes(floor.kind as FloorKind)) {
    add('file.floor.kind', `The floor's kind must be one of ${FLOOR_KINDS.join(', ')}.`);
  } else {
    floorKind = floor.kind as FloorKind;
    if (floorKind === 'NONE') {
      if (floor.outline !== undefined) {
        add('file.floor.outline', 'A floor of kind NONE has no outline.');
      }
    } else if (floor.outline === undefined) {
      add('file.floor.outline', `A floor of kind ${floorKind} needs an outline.`);
    } else {
      floorOutline = outline(floor.outline, 'file.floor.outline', 'The floor');
    }
  }

  // Levels: keys, names and ranks unique.
  const levels: CheckedLevel[] = [];
  const keys = new Set<string>();
  if (!Array.isArray(file.levels) || file.levels.length === 0) {
    add('file.levels', 'The layout file needs at least one price level.');
  } else {
    if (file.levels.length > LAYOUT_LIMITS.maxLevels) {
      add(
        'file.levels',
        `${file.levels.length} levels; a layout has at most ${LAYOUT_LIMITS.maxLevels}`,
      );
    }
    const names = new Set<string>();
    const ranks = new Set<number>();
    file.levels.forEach((raw, i) => {
      const path = `file.levels[${i}]`;
      if (!isObject(raw)) {
        add(path, `Level ${i + 1} must be an object with a key, name, rank and color.`);
        return;
      }
      const key = typeof raw.key === 'string' && KEY.test(raw.key) ? raw.key : null;
      if (key === null) {
        add(
          `${path}.key`,
          `Level ${i + 1}: the key must be 1 to 30 lower-case letters, digits or hyphens.`,
        );
      } else if (keys.has(key)) {
        add(`${path}.key`, `Level key "${key}" appears twice`);
      } else keys.add(key);
      const place = key ? `Level "${key}"` : `Level ${i + 1}`;
      const levelName = checkName(raw.name, `${path}.name`, `${place}: the name`, add);
      if (levelName !== null) {
        if (names.has(fold(levelName))) add(`${path}.name`, `Level ${levelName} appears twice`);
        names.add(fold(levelName));
      }
      let rank: number | null = null;
      if (!isInt(raw.rank) || raw.rank < 1 || raw.rank > LAYOUT_LIMITS.maxLevels) {
        add(`${path}.rank`, `${place}: the rank must be a whole number from 1 to 12.`);
      } else if (ranks.has(raw.rank)) {
        add(`${path}.rank`, `${place}: rank ${raw.rank} is another level's too`);
      } else {
        rank = raw.rank;
        ranks.add(rank);
      }
      const color = LEVEL_COLORS.includes(raw.color as LevelColor)
        ? (raw.color as LevelColor)
        : null;
      if (color === null) {
        add(`${path}.color`, `${place}: the color must be one of ${LEVEL_COLORS.join(', ')}.`);
      }
      if (key && levelName !== null && rank !== null && color) {
        levels.push({ key, name: levelName, rank, color });
      }
    });
  }

  /** A level key that names a level of the file, or a problem. */
  const levelKey = (v: unknown, path: string, place: string, required: boolean): string | null => {
    if (v === undefined && !required) return null;
    if (typeof v !== 'string') {
      add(path, `${place}: the level must be a level's key.`);
      return null;
    }
    if (!keys.has(v)) {
      add(path, `${place}: level "${v}" is not in the file`);
      return null;
    }
    return v;
  };

  // Sections, their rows and seats.
  const sections: CheckedSection[] = [];
  let seatCount = 0;
  if (!Array.isArray(file.sections) || file.sections.length === 0) {
    add('file.sections', 'The layout file needs at least one section.');
  } else {
    if (file.sections.length > LAYOUT_LIMITS.maxSections) {
      add(
        'file.sections',
        `${file.sections.length} sections; a layout has at most ${LAYOUT_LIMITS.maxSections}`,
      );
    }
    const sectionNames = new Set<string>();
    file.sections.forEach((raw, i) => {
      const path = `file.sections[${i}]`;
      if (!isObject(raw)) {
        add(path, `Section ${i + 1} must be an object with a name, level, outline and rows.`);
        return;
      }
      const sectionName = checkName(raw.name, `${path}.name`, `Section ${i + 1}: the name`, add);
      const place = `Section ${sectionName ?? i + 1}`;
      if (sectionName !== null) {
        if (sectionNames.has(fold(sectionName))) add(`${path}.name`, `${place} appears twice`);
        sectionNames.add(fold(sectionName));
      }
      const key = levelKey(raw.level, `${path}.level`, place, true);
      const shape = outline(raw.outline, `${path}.outline`, place);
      const labelAt =
        raw.labelAt === undefined
          ? shape && centroid(shape)
          : point(raw.labelAt, `${path}.labelAt`, `${place}: the label point`);

      const rows: CheckedRow[] = [];
      if (!Array.isArray(raw.rows) || raw.rows.length === 0) {
        add(`${path}.rows`, `${place}: a section needs at least one row.`);
      } else {
        if (raw.rows.length > LAYOUT_LIMITS.maxRows) {
          add(
            `${path}.rows`,
            `${place}: ${raw.rows.length} rows; a section has at most ${LAYOUT_LIMITS.maxRows}`,
          );
        }
        const rowLabels = new Set<string>();
        raw.rows.forEach((rawRow, j) => {
          const rowPath = `${path}.rows[${j}]`;
          if (!isObject(rawRow)) {
            add(rowPath, `${place}, row ${j + 1} must be an object with a label and seats.`);
            return;
          }
          const label = checkLabel(rawRow.label, `${rowPath}.label`, `${place}, row ${j + 1}`, add);
          const rowPlace = `${place}, row ${label ?? j + 1}`;
          if (label !== null) {
            if (rowLabels.has(fold(label))) add(`${rowPath}.label`, `${rowPlace} appears twice`);
            rowLabels.add(fold(label));
          }
          const rowLevel = levelKey(rawRow.level, `${rowPath}.level`, rowPlace, false);
          const seats = checkSeats(rawRow.seats, `${rowPath}.seats`, rowPlace);
          seatCount += seats?.length ?? 0;
          if (label !== null && seats) {
            rows.push({ number: j + 1, label, levelKey: rowLevel, seats });
          }
        });
      }
      if (sectionName !== null && key && shape && labelAt) {
        sections.push({ name: sectionName, levelKey: key, outline: shape, labelAt, rows });
      }
    });
    if (seatCount > LAYOUT_LIMITS.maxSeats) {
      add(
        'file.sections',
        `${count(seatCount)} seats; a layout has at most ${count(LAYOUT_LIMITS.maxSeats)}`,
      );
    }
  }

  /** A row's seats, listed or as a run, with unique labels, inside the map. */
  function checkSeats(v: unknown, path: string, rowPlace: string): CheckedSeat[] | null {
    let listed: { label?: unknown; at?: unknown; level?: unknown; accessible?: unknown }[];
    let run = false;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        add(path, `${rowPlace}: a row needs at least one seat.`);
        return null;
      }
      if (v.length > LAYOUT_LIMITS.maxSeatsPerRow) {
        add(
          path,
          `${rowPlace}: ${v.length} seats; a row has at most ${LAYOUT_LIMITS.maxSeatsPerRow}`,
        );
        return null;
      }
      listed = v.map((s) => (isObject(s) ? s : {}));
    } else if (isObject(v)) {
      run = true;
      const { first, count: n } = v;
      if (!isInt(first) || first < 1 || first > 9999) {
        add(
          `${path}.first`,
          `${rowPlace}: a run's first seat must be a whole number from 1 to 9,999.`,
        );
        return null;
      }
      if (!isInt(n) || n < 1) {
        add(`${path}.count`, `${rowPlace}: a run's count must be a whole number of 1 or more.`);
        return null;
      }
      if (n > LAYOUT_LIMITS.maxSeatsPerRow) {
        add(
          `${path}.count`,
          `${rowPlace}: ${n} seats; a row has at most ${LAYOUT_LIMITS.maxSeatsPerRow}`,
        );
        return null;
      }
      const from = point(v.from, `${path}.from`, `${rowPlace}: the run's start`);
      const to = point(v.to, `${path}.to`, `${rowPlace}: the run's end`);
      const bend =
        v.bend === undefined ? undefined : point(v.bend, `${path}.bend`, `${rowPlace}: the bend`);
      if (!from || !to || bend === null) return null;
      listed = expandRun({ first, count: n, from, to, ...(bend ? { bend } : {}) });
    } else {
      add(path, `${rowPlace}: seats must be a list of seats or a run.`);
      return null;
    }

    const seats: CheckedSeat[] = [];
    const labels = new Set<string>();
    let ok = true;
    listed.forEach((s, k) => {
      const seatPath = run ? path : `${path}[${k}]`;
      const label = checkLabel(
        s.label,
        `${seatPath}${run ? '' : '.label'}`,
        `${rowPlace}, seat ${k + 1}`,
        add,
      );
      if (label === null) {
        ok = false;
        return;
      }
      if (labels.has(fold(label))) {
        add(seatPath, `${rowPlace}: seat ${label} appears twice`);
        ok = false;
        return;
      }
      labels.add(fold(label));
      const at = point(s.at, run ? path : `${seatPath}.at`, `${rowPlace}: seat ${label}`);
      const level = run
        ? null
        : levelKey(s.level, `${seatPath}.level`, `${rowPlace}, seat ${label}`, false);
      if (!run && s.level !== undefined && level === null) ok = false;
      if (!run && s.accessible !== undefined && typeof s.accessible !== 'boolean') {
        add(
          `${seatPath}.accessible`,
          `${rowPlace}, seat ${label}: accessible must be true or false.`,
        );
        ok = false;
      }
      if (!at) {
        ok = false;
        return;
      }
      seats.push({
        number: k + 1,
        label,
        at,
        levelKey: level,
        accessible: !run && s.accessible === true,
      });
    });
    return ok ? seats : null;
  }

  if (problems.length > 0 || name === null) return done();
  return {
    ok: true,
    layout: { name, floorKind, floorOutline, width, height, levels, sections, seatCount },
  };
}

/** A name of 1 to 50 characters after trimming, or null with a problem. */
function checkName(
  v: unknown,
  path: string,
  what: string,
  add: (path: string, message: string) => void,
): string | null {
  if (typeof v !== 'string' || v.trim() === '') {
    add(path, `${what} is missing.`);
    return null;
  }
  const name = v.trim();
  if (name.length > LAYOUT_LIMITS.nameMaxLength) {
    add(path, `${what} has ${name.length} characters; at most ${LAYOUT_LIMITS.nameMaxLength}`);
    return null;
  }
  return name;
}

/** A row or seat label of 1 to 5 characters after trimming, or null with a problem. */
function checkLabel(
  v: unknown,
  path: string,
  place: string,
  add: (path: string, message: string) => void,
): string | null {
  if (typeof v !== 'string' || v.trim() === '') {
    add(path, `${place}: the label is missing.`);
    return null;
  }
  const label = v.trim();
  if (label.length > LAYOUT_LIMITS.labelMaxLength) {
    add(
      path,
      `${place}: the label "${label}" has ${label.length} characters; at most ${LAYOUT_LIMITS.labelMaxLength}`,
    );
    return null;
  }
  return label;
}
