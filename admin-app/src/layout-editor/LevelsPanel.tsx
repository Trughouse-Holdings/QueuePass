import type { EditorDoc } from './editor-doc';
import { totals } from './editor-state';

/**
 * Spec 039 FR-015, FR-017, FR-018 (research R12): the layout's price levels, best first, each
 * named beside its color with the seats in it.
 */
export function LevelsPanel({ doc }: { doc: EditorDoc }): React.ReactElement {
  const t = totals(doc);
  return (
    <section className="card editor-panel" aria-labelledby="editor-levels-heading">
      <h2 id="editor-levels-heading">Price levels</h2>
      <ol className="editor-levels">
        {doc.levels.map((l) => (
          <li key={l.id} className="editor-levels__item">
            <span className={`level-swatch level-swatch--${l.color}`} aria-hidden="true" />
            <span className="editor-levels__name">{l.name}</span>
            <span className="editor-levels__count">{`${(t.byLevel[l.id] ?? 0).toLocaleString()} seats`}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
