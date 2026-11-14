import { useState } from 'react';
import type { SectionGenerator } from '@queuepass/shared';
import { AddSectionForm } from './AddSectionForm';
import type { EditorDoc } from './editor-doc';
import { seatCount, totals, type Selection } from './editor-state';

const count = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Spec 039 FR-011, FR-017, FR-026 (research R14; T032, T053): the Sections panel. The totals
 * ("2 sections · 348 seats", the seats left under 30,000), every section as a button that selects
 * it (Shift adds), and Add section with the block generator.
 */
export function SectionsPanel({
  doc,
  selection,
  levelId,
  onSelect,
  onAdd,
  children,
}: {
  doc: EditorDoc;
  selection: Selection;
  /** The level a new section takes unless another is chosen. */
  levelId: string;
  onSelect: (id: string, add: boolean) => void;
  onAdd: (name: string, values: SectionGenerator, levelId: string) => void;
  /** The selection's section actions (Duplicate, Delete), under the list. */
  children?: React.ReactNode;
}): React.ReactElement {
  const [adding, setAdding] = useState(false);
  const t = totals(doc);
  const selected = new Set(selection.kind === 'sections' ? selection.ids : []);
  return (
    <section className="card editor-panel" aria-labelledby="editor-sections-heading">
      <h2 id="editor-sections-heading">Sections</h2>
      <p className="editor-panel__totals">
        {`${count(t.sections, 'section')} · ${count(t.seats, 'seat')}`}
      </p>
      <p className="note">{`${t.seatsLeft.toLocaleString()} seats left of 30,000`}</p>
      {doc.sections.length > 0 && (
        <ul className="editor-list" aria-label="Sections of the layout">
          {doc.sections.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="editor-list__item"
                aria-pressed={selected.has(s.id)}
                onClick={(e) => onSelect(s.id, e.shiftKey)}
              >
                {`${s.name} · ${count(seatCount(s), 'seat')}`}
              </button>
            </li>
          ))}
        </ul>
      )}
      {children}
      {adding ? (
        <AddSectionForm
          doc={doc}
          levelId={levelId}
          onGenerate={(name, values, level) => {
            onAdd(name, values, level);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className="form__actions">
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            Add section
          </button>
        </div>
      )}
    </section>
  );
}
