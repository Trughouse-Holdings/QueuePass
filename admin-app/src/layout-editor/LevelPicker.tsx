import { useId } from 'react';
import { levelName, type EditorDoc } from './editor-doc';
import type { Action, Selection } from './editor-state';

const MIXED = '__mixed';
const INHERIT = '__inherit';

/**
 * Spec 039 US2 (FR-016, FR-018; walk feedback, 2026-11-14): the selection's price level, chosen
 * where the selection is shown. It shows the level the selected sections, rows or seats have
 * ("Mixed" when they differ); choosing a level gives it to them at once (one Undo step). Rows
 * and seats can also take "Same as the section" or "Same as the row", which clears their own
 * level. Each level is named, with its color beside the box.
 */
export function LevelPicker({
  doc,
  selection,
  dispatch,
}: {
  doc: EditorDoc;
  selection: Extract<Selection, { kind: 'sections' | 'rows' | 'seats' }>;
  dispatch: (a: Action) => void;
}): React.ReactElement | null {
  const id = useId();
  let own: (string | null)[] = [];
  let inherit: string | null = null;
  if (selection.kind === 'sections') {
    own = doc.sections.filter((s) => selection.ids.includes(s.id)).map((s) => s.levelId);
  } else {
    const section = doc.sections.find((s) => s.id === selection.sectionId);
    if (!section) return null;
    if (selection.kind === 'rows') {
      own = section.rows.filter((r) => selection.ids.includes(r.id)).map((r) => r.levelId);
      inherit = `Same as the section (${levelName(doc, section.levelId)})`;
    } else {
      const rowLevels = new Set<string>();
      for (const r of section.rows) {
        for (const q of r.seats) {
          if (!selection.ids.includes(q.id)) continue;
          own.push(q.levelId);
          rowLevels.add(r.levelId ?? section.levelId);
        }
      }
      inherit =
        rowLevels.size === 1
          ? `Same as the row (${levelName(doc, [...rowLevels][0])})`
          : 'Same as the row';
    }
  }
  if (own.length === 0) return null;
  const values = new Set(own.map((v) => v ?? INHERIT));
  const value = values.size === 1 ? [...values][0] : MIXED;
  const shownLevel = doc.levels.find((l) => l.id === value);

  return (
    <div className="field editor-level-picker">
      <label htmlFor={id}>Price level</label>
      <div className="editor-level-picker__row">
        <span
          className={`level-swatch level-swatch--${shownLevel?.color ?? 'none'}`}
          aria-hidden="true"
          hidden={!shownLevel}
        />
        <select
          id={id}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === MIXED) return;
            dispatch(v === INHERIT ? { type: 'clearLevel' } : { type: 'paint', levelId: v });
          }}
        >
          {value === MIXED && (
            <option value={MIXED} disabled>
              Mixed
            </option>
          )}
          {inherit && <option value={INHERIT}>{inherit}</option>}
          {doc.levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
