import {
  checkBlock,
  LAYOUT_LIMITS,
  LEVEL_COLORS,
  type FloorKind,
  type LevelColor,
  type SectionGenerator,
} from '@queuepass/shared';
import {
  capped,
  checkLabel,
  checkName,
  count,
  FLOOR_KINDS,
  fold,
  isInt,
  isObject,
  show,
  type Json,
  type Problem,
} from './layout-file';
import type { Point } from './seat-runs';

/**
 * Spec 039 FR-019, research R4, R16 (T010): a `LayoutDrawingInput` checked as a whole before
 * anything is saved, with the checks a layout file has (names, labels, keys, limits, places;
 * `layout-file.ts`) and a drawing's own: every place from 0 to 5,000, no control characters in a
 * name or label, no field the contract doesn't name, and, on a save over an existing layout, every
 * id of that layout, of the right kind, under its own parent, and sent once. Problems have paths
 * into the body (`sections[12].rows[2].seats[6].label`) and messages naming the place as people
 * read it; the first 50 are kept, the rest counted.
 */

/** The ids of an existing layout, by kind, each row's section and each seat's row. */
export interface ExistingIds {
  levels: ReadonlySet<string>;
  sections: ReadonlySet<string>;
  /** Row id → its section's id. */
  rows: ReadonlyMap<string, string>;
  /** Seat id → its row's id. */
  seats: ReadonlyMap<string, string>;
}

export interface DrawnSeat {
  id: string | null;
  /** Its place in its row, from 1, in the order sent. */
  number: number;
  label: string;
  at: Point;
  levelKey: string | null;
  accessible: boolean;
}
export interface DrawnRow {
  id: string | null;
  /** Its place in its section, from 1, front first, in the order sent. */
  number: number;
  label: string;
  levelKey: string | null;
  seats: DrawnSeat[];
}
export interface DrawnSection {
  id: string | null;
  name: string;
  levelKey: string;
  origin: Point;
  /** In (-180, 180]. */
  angle: number;
  generator: SectionGenerator | null;
  rows: DrawnRow[];
}
export interface DrawnLevel {
  id: string | null;
  key: string;
  name: string;
  /** Its place in the list, from 1. */
  rank: number;
  color: LevelColor;
}
export interface CheckedDrawing {
  name: string;
  floorKind: FloorKind;
  floorOutline: Point[] | null;
  levels: DrawnLevel[];
  sections: DrawnSection[];
  seatCount: number;
}

export type DrawingResult =
  { ok: true; drawing: CheckedDrawing } | { ok: false; problems: Problem[]; more: number };

const KEY = /^[a-z0-9-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX = LAYOUT_LIMITS.maxMapUnits;

/** The fields each part of a drawing may have (the contract's `additionalProperties: false`). */
const FIELDS = {
  top: ['revision', 'name', 'floor', 'levels', 'sections'],
  floor: ['kind', 'outline'],
  level: ['id', 'key', 'name', 'color'],
  section: ['id', 'name', 'level', 'origin', 'angle', 'generator', 'rows'],
  row: ['id', 'label', 'level', 'seats'],
  seat: ['id', 'label', 'at', 'level', 'accessible'],
  generator: ['rows', 'seatsPerRow', 'rowLabels', 'firstRow', 'firstSeat', 'direction', 'curve'],
} as const;

/**
 * Checks `body` (the request body, any JSON) as a drawing. `existing` is the layout it is saved
 * over, or `null` for a new layout, whose ids are then ignored.
 */
export function checkDrawing(body: unknown, existing: ExistingIds | null): DrawingResult {
  const problems: Problem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });
  const done = (): DrawingResult => ({ ok: false, ...capped(problems) });

  if (!isObject(body)) {
    add('', 'The layout must be a JSON object.');
    return done();
  }
  unknownFields(body, FIELDS.top, '', add);

  /** A name: 1 to 50 characters after trimming, no control character. */
  const name = (v: unknown, path: string, what: string): string | null => {
    const n = checkName(v, path, what, add);
    if (n !== null && CONTROL.test(n)) {
      add(path, `${what} has a control character`);
      return null;
    }
    return n;
  };
  const label = (v: unknown, path: string, place: string): string | null => {
    const l = checkLabel(v, path, place, add);
    if (l !== null && CONTROL.test(l)) {
      add(path, `${place}: the label has a control character`);
      return null;
    }
    return l;
  };
  /** A place `[x, y]` from 0 to 5,000, or null with a problem. */
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
    if (p[0] < 0 || p[1] < 0 || p[0] > MAX || p[1] > MAX) {
      add(path, `${what} (${show(p[0])}, ${show(p[1])}) is outside the map (0 to ${count(MAX)})`);
      return null;
    }
    return p;
  };

  // Ids: of this layout, of the right kind, under the right parent, each sent once.
  const seen = new Set<string>();
  const idOf = (
    v: unknown,
    path: string,
    place: string,
    kind: 'level' | 'section' | 'row' | 'seat',
    parent: { id: string | null; name: string } | null,
  ): string | null => {
    if (existing === null || v === undefined) return null;
    if (typeof v !== 'string' || !UUID.test(v)) {
      add(path, `${place}: the id must be a UUID.`);
      return null;
    }
    const id = v.toLowerCase();
    if (seen.has(id)) {
      add(path, `${place}: id ${id} is sent twice`);
      return null;
    }
    seen.add(id);
    const ok =
      kind === 'level'
        ? existing.levels.has(id)
        : kind === 'section'
          ? existing.sections.has(id)
          : kind === 'row'
            ? parent?.id != null && existing.rows.get(id) === parent.id
            : parent?.id != null && existing.seats.get(id) === parent.id;
    if (!ok) {
      add(
        path,
        kind === 'level' || kind === 'section'
          ? `${place}: id ${id} is not a ${kind} of this layout`
          : `${place}: id ${id} is not a ${kind} of ${parent?.name}`,
      );
      return null;
    }
    return id;
  };

  const layoutName = name(body.name, 'name', "The layout's name");

  // The floor object: an outline exactly when it is not NONE.
  let floorKind: FloorKind = 'NONE';
  let floorOutline: Point[] | null = null;
  const floor = body.floor;
  if (!isObject(floor)) {
    add('floor', 'The layout needs a floor with its kind.');
  } else {
    unknownFields(floor, FIELDS.floor, 'floor', add);
    if (!FLOOR_KINDS.includes(floor.kind as FloorKind)) {
      add('floor.kind', `The floor's kind must be one of ${FLOOR_KINDS.join(', ')}.`);
    } else {
      floorKind = floor.kind as FloorKind;
      if (floorKind === 'NONE') {
        if (floor.outline !== undefined)
          add('floor.outline', 'A floor of kind NONE has no outline.');
      } else if (!Array.isArray(floor.outline)) {
        add('floor.outline', `A floor of kind ${floorKind} needs an outline.`);
      } else if (
        floor.outline.length < 3 ||
        floor.outline.length > LAYOUT_LIMITS.maxOutlinePoints
      ) {
        add(
          'floor.outline',
          `The floor's outline has ${floor.outline.length} points; it needs 3 to ` +
            `${LAYOUT_LIMITS.maxOutlinePoints}`,
        );
      } else {
        const points = floor.outline.map((p, i) =>
          point(p, `floor.outline[${i}]`, `The floor: outline point ${i + 1}`),
        );
        if (points.every((p) => p !== null)) floorOutline = points as Point[];
      }
    }
  }

  // Levels: keys and names unique; the order is the rank.
  const levels: DrawnLevel[] = [];
  const keys = new Set<string>();
  if (!Array.isArray(body.levels) || body.levels.length === 0) {
    add('levels', 'The layout needs at least one price level.');
  } else {
    if (body.levels.length > LAYOUT_LIMITS.maxLevels) {
      add(
        'levels',
        `${body.levels.length} levels; a layout has at most ${LAYOUT_LIMITS.maxLevels}`,
      );
    }
    const names = new Set<string>();
    body.levels.forEach((raw, i) => {
      const path = `levels[${i}]`;
      if (!isObject(raw)) {
        add(path, `Level ${i + 1} must be an object with a key, name and color.`);
        return;
      }
      unknownFields(raw, FIELDS.level, path, add);
      const key = typeof raw.key === 'string' && KEY.test(raw.key) ? raw.key : null;
      if (key === null) {
        add(
          `${path}.key`,
          `Level ${i + 1}: the key must be 1 to 40 lower-case letters, digits or hyphens.`,
        );
      } else if (keys.has(key)) {
        add(`${path}.key`, `Level key "${key}" appears twice`);
      } else keys.add(key);
      const place = key ? `Level "${key}"` : `Level ${i + 1}`;
      const levelName = name(raw.name, `${path}.name`, `${place}: the name`);
      if (levelName !== null) {
        if (names.has(fold(levelName))) add(`${path}.name`, `Level ${levelName} appears twice`);
        names.add(fold(levelName));
      }
      const color = LEVEL_COLORS.includes(raw.color as LevelColor)
        ? (raw.color as LevelColor)
        : null;
      if (color === null) {
        add(`${path}.color`, `${place}: the color must be one of ${LEVEL_COLORS.join(', ')}.`);
      }
      const id = idOf(raw.id, `${path}.id`, place, 'level', null);
      if (key && levelName !== null && color) {
        levels.push({ id, key, name: levelName, rank: i + 1, color });
      }
    });
  }

  /** A level key of this body, or a problem. */
  const levelKey = (v: unknown, path: string, place: string, required: boolean): string | null => {
    if (v === undefined && !required) return null;
    if (typeof v !== 'string') {
      add(path, `${place}: the level must be a level's key.`);
      return null;
    }
    if (!keys.has(v)) {
      add(path, `${place}: level "${v}" is not in the layout`);
      return null;
    }
    return v;
  };

  // Sections, their rows and seats.
  const sections: DrawnSection[] = [];
  let seatCount = 0;
  if (!Array.isArray(body.sections) || body.sections.length === 0) {
    add('sections', 'The layout needs at least one section.');
  } else {
    if (body.sections.length > LAYOUT_LIMITS.maxSections) {
      add(
        'sections',
        `${body.sections.length} sections; a layout has at most ${LAYOUT_LIMITS.maxSections}`,
      );
    }
    const sectionNames = new Set<string>();
    body.sections.forEach((raw, i) => {
      const path = `sections[${i}]`;
      if (!isObject(raw)) {
        add(path, `Section ${i + 1} must be an object with a name, level, origin, angle and rows.`);
        return;
      }
      unknownFields(raw, FIELDS.section, path, add);
      const sectionName = name(raw.name, `${path}.name`, `Section ${i + 1}: the name`);
      const place = `Section ${sectionName ?? i + 1}`;
      if (sectionName !== null) {
        if (sectionNames.has(fold(sectionName))) add(`${path}.name`, `${place} appears twice`);
        sectionNames.add(fold(sectionName));
      }
      const id = idOf(raw.id, `${path}.id`, place, 'section', null);
      const key = levelKey(raw.level, `${path}.level`, place, true);
      const origin = point(raw.origin, `${path}.origin`, `${place}: the origin`);
      let angle: number | null = null;
      if (
        typeof raw.angle !== 'number' ||
        !Number.isFinite(raw.angle) ||
        raw.angle < -180 ||
        raw.angle > 180
      ) {
        add(`${path}.angle`, `${place}: the angle must be a number from -180 to 180.`);
      } else angle = raw.angle === -180 ? 180 : raw.angle;
      const generator = checkGenerator(raw.generator, `${path}.generator`, place, add);

      const rows: DrawnRow[] = [];
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
          unknownFields(rawRow, FIELDS.row, rowPath, add);
          const rowLabel = label(rawRow.label, `${rowPath}.label`, `${place}, row ${j + 1}`);
          const rowPlace = `${place}, row ${rowLabel ?? j + 1}`;
          if (rowLabel !== null) {
            if (rowLabels.has(fold(rowLabel))) {
              add(`${rowPath}.label`, `${rowPlace} appears twice`);
            }
            rowLabels.add(fold(rowLabel));
          }
          const rowId = idOf(rawRow.id, `${rowPath}.id`, rowPlace, 'row', {
            id,
            name: `section ${sectionName ?? i + 1}`,
          });
          const rowLevel = levelKey(rawRow.level, `${rowPath}.level`, rowPlace, false);
          const seats = checkSeats(rawRow.seats, `${rowPath}.seats`, rowPlace, {
            id: rowId,
            name: `row ${rowLabel ?? j + 1}`,
          });
          seatCount += seats?.length ?? 0;
          if (rowLabel !== null && seats) {
            rows.push({ id: rowId, number: j + 1, label: rowLabel, levelKey: rowLevel, seats });
          }
        });
      }
      if (sectionName !== null && key && origin && angle !== null && generator !== undefined) {
        sections.push({ id, name: sectionName, levelKey: key, origin, angle, generator, rows });
      }
    });
    if (seatCount > LAYOUT_LIMITS.maxSeats) {
      add(
        'sections',
        `${count(seatCount)} seats; a layout has at most ${count(LAYOUT_LIMITS.maxSeats)}`,
      );
    }
  }

  /** A row's seats: 1 to 200, unique labels, places inside the map. */
  function checkSeats(
    v: unknown,
    path: string,
    rowPlace: string,
    row: { id: string | null; name: string },
  ): DrawnSeat[] | null {
    if (!Array.isArray(v) || v.length === 0) {
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
    const seats: DrawnSeat[] = [];
    const labels = new Set<string>();
    let ok = true;
    v.forEach((s, k) => {
      const seatPath = `${path}[${k}]`;
      if (!isObject(s)) {
        add(seatPath, `${rowPlace}, seat ${k + 1} must be an object with a label and a place.`);
        ok = false;
        return;
      }
      unknownFields(s, FIELDS.seat, seatPath, add);
      const seatLabel = label(s.label, `${seatPath}.label`, `${rowPlace}, seat ${k + 1}`);
      if (seatLabel === null) {
        ok = false;
        return;
      }
      if (labels.has(fold(seatLabel))) {
        add(`${seatPath}.label`, `${rowPlace}: seat ${seatLabel} appears twice`);
        ok = false;
        return;
      }
      labels.add(fold(seatLabel));
      const seatPlace = `${rowPlace}: seat ${seatLabel}`;
      const at = point(s.at, `${seatPath}.at`, seatPlace);
      const level = levelKey(s.level, `${seatPath}.level`, `${rowPlace}, seat ${seatLabel}`, false);
      if (s.level !== undefined && level === null) ok = false;
      if (s.accessible !== undefined && typeof s.accessible !== 'boolean') {
        add(`${seatPath}.accessible`, `${seatPlace}: accessible must be true or false.`);
        ok = false;
      }
      const id = idOf(s.id, `${seatPath}.id`, `${rowPlace}, seat ${seatLabel}`, 'seat', row);
      if (!at) {
        ok = false;
        return;
      }
      seats.push({
        id,
        number: k + 1,
        label: seatLabel,
        at,
        levelKey: level,
        accessible: s.accessible === true,
      });
    });
    return ok ? seats : null;
  }

  if (problems.length > 0 || layoutName === null) return done();
  return {
    ok: true,
    drawing: { name: layoutName, floorKind, floorOutline, levels, sections, seatCount },
  };
}

/** A field the contract doesn't name, refused where it is. */
function unknownFields(
  obj: Json,
  known: readonly string[],
  path: string,
  add: (path: string, message: string) => void,
): void {
  for (const k of Object.keys(obj)) {
    if (!known.includes(k)) add(path ? `${path}.${k}` : k, `Unknown field "${k}"`);
  }
}

/**
 * A section's generator values (contract `SectionGenerator`), `null` when not generated; one
 * problem at the generator when its values could not have made a block (`checkBlock`). Returns
 * `undefined` with that problem.
 */
function checkGenerator(
  v: unknown,
  path: string,
  place: string,
  add: (path: string, message: string) => void,
): SectionGenerator | null | undefined {
  if (v === undefined || v === null) return null;
  const bad = (why: string) => {
    add(path, `${place}: the generator values are not valid: ${why}`);
    return undefined;
  };
  if (!isObject(v)) return bad('they must be an object.');
  const extra = Object.keys(v).find((k) => !(FIELDS.generator as readonly string[]).includes(k));
  if (extra) return bad(`unknown field "${extra}".`);
  const g = v as Partial<SectionGenerator>;
  if (
    !isInt(g.rows) ||
    !Array.isArray(g.seatsPerRow) ||
    !g.seatsPerRow.every(isInt) ||
    g.seatsPerRow.length > LAYOUT_LIMITS.maxRows ||
    (g.rowLabels !== 'LETTERS' && g.rowLabels !== 'NUMBERS') ||
    typeof g.firstRow !== 'string' ||
    !isInt(g.firstSeat) ||
    (g.direction !== 'LEFT_TO_RIGHT' && g.direction !== 'RIGHT_TO_LEFT') ||
    typeof g.curve !== 'number'
  ) {
    return bad('every field of the generator is needed, of its type.');
  }
  const value = g as SectionGenerator;
  const problems = checkBlock(value);
  if (problems.length > 0) return bad(problems[0].message);
  return {
    rows: value.rows,
    seatsPerRow: value.seatsPerRow,
    rowLabels: value.rowLabels,
    firstRow: value.firstRow,
    firstSeat: value.firstSeat,
    direction: value.direction,
    curve: value.curve,
  };
}
