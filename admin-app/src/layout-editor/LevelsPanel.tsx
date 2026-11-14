import { useEffect, useId, useRef, useState } from 'react';
import { LAYOUT_LIMITS, LEVEL_COLORS } from '@queuepass/shared';
import type { EdLevel, EditorDoc } from './editor-doc';
import { levelNameProblem, totals, type Action, type Selection } from './editor-state';

const seats = (n: number): string => `${n.toLocaleString()} ${n === 1 ? 'seat' : 'seats'}`;
const colorName = (c: string): string => c.charAt(0).toUpperCase() + c.slice(1);

/**
 * Spec 039 US2 (FR-015–FR-018; research R12; T043): the layout's price levels, best first (the
 * order is the rank), each named beside its color with the seats in it, and the whole layout's
 * total. Choosing a level (the radio) and Paint sets it on the selection; Use section's level
 * clears a row's or seat's own level. Each level is renamed in place, recolored from the theme's
 * 12 level colors, moved up or down, or deleted after choosing the level its seats take; the last
 * level can't be deleted. Read-only, it is the list alone.
 */
export function LevelsPanel({
  doc,
  dispatch,
  selection,
  chosen,
  onChoose,
  readOnly = false,
}: {
  doc: EditorDoc;
  dispatch?: (a: Action) => void;
  selection?: Selection;
  /** The level Paint and Add section use. */
  chosen?: string;
  onChoose?: (id: string) => void;
  readOnly?: boolean;
}): React.ReactElement {
  const t = totals(doc);
  const [deleting, setDeleting] = useState<string | null>(null);
  const lastId = useId();
  const edit = !readOnly && dispatch;
  const chosenLevel = doc.levels.find((l) => l.id === chosen) ?? doc.levels[0];
  const sel = selection ?? { kind: 'none' };
  const canPaint = sel.kind === 'sections' || sel.kind === 'rows' || sel.kind === 'seats';
  const canClear = sel.kind === 'rows' || sel.kind === 'seats';

  return (
    <section className="card editor-panel" aria-labelledby="editor-levels-heading">
      <h2 id="editor-levels-heading">Price levels</h2>
      <ol className="editor-levels">
        {doc.levels.map((l, i) => (
          <li key={l.id} className="editor-levels__item">
            {edit ? (
              <label className="editor-levels__choose">
                <input
                  type="radio"
                  name="editor-paint-level"
                  checked={chosenLevel?.id === l.id}
                  onChange={() => onChoose?.(l.id)}
                />
                <span className={`level-swatch level-swatch--${l.color}`} aria-hidden="true" />
                <span className="editor-levels__name">{l.name}</span>
              </label>
            ) : (
              <span className="editor-levels__choose">
                <span className={`level-swatch level-swatch--${l.color}`} aria-hidden="true" />
                <span className="editor-levels__name">{l.name}</span>
              </span>
            )}
            <span className="editor-levels__count">{seats(t.byLevel[l.id] ?? 0)}</span>
            {edit && (
              <div className="editor-levels__edit">
                <LevelNameBox doc={doc} level={l} dispatch={dispatch} />
                <select
                  aria-label={`Color of ${l.name}`}
                  value={l.color}
                  onChange={(e) =>
                    dispatch({
                      type: 'recolorLevel',
                      id: l.id,
                      color: e.target.value as EdLevel['color'],
                    })
                  }
                >
                  {LEVEL_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {colorName(c)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn--ghost"
                  aria-label={`Move ${l.name} up`}
                  disabled={i === 0}
                  onClick={() => dispatch({ type: 'moveLevel', id: l.id, by: -1 })}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  aria-label={`Move ${l.name} down`}
                  disabled={i === doc.levels.length - 1}
                  onClick={() => dispatch({ type: 'moveLevel', id: l.id, by: 1 })}
                >
                  Down
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  aria-label={`Delete ${l.name}`}
                  disabled={doc.levels.length <= 1}
                  aria-describedby={doc.levels.length <= 1 ? lastId : undefined}
                  onClick={() => setDeleting(l.id)}
                >
                  Delete
                </button>
                {deleting === l.id && (
                  <DeleteLevel
                    doc={doc}
                    level={l}
                    count={t.byLevel[l.id] ?? 0}
                    onDelete={(replacement) => {
                      dispatch({ type: 'deleteLevel', id: l.id, replacement });
                      setDeleting(null);
                      if (chosen === l.id) onChoose?.(replacement);
                    }}
                    onCancel={() => setDeleting(null)}
                  />
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className="editor-panel__totals">{`Total: ${seats(t.seats)}`}</p>
      {edit && doc.levels.length <= 1 && (
        <p id={lastId} className="note">
          The last level can&apos;t be deleted
        </p>
      )}
      {edit && (
        <>
          <div className="form__actions">
            <button
              type="button"
              className="btn"
              disabled={doc.levels.length >= LAYOUT_LIMITS.maxLevels}
              onClick={() => dispatch({ type: 'addLevel' })}
            >
              Add level
            </button>
          </div>
          <div className="form__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canPaint || !chosenLevel}
              onClick={() => chosenLevel && dispatch({ type: 'paint', levelId: chosenLevel.id })}
            >
              {`Paint: ${chosenLevel?.name ?? ''}`}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!canClear}
              onClick={() => dispatch({ type: 'clearLevel' })}
            >
              Use section&apos;s level
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** A level's name, typed in place and kept on Enter or leaving the box; a refusal beside it. */
function LevelNameBox({
  doc,
  level,
  dispatch,
}: {
  doc: EditorDoc;
  level: EdLevel;
  dispatch: (a: Action) => void;
}): React.ReactElement {
  const [text, setText] = useState(level.name);
  const [problem, setProblem] = useState<string | null>(null);
  const focused = useRef(false);
  const problemId = useId();
  useEffect(() => {
    if (!focused.current) setText(level.name);
  }, [level.name]);
  const keep = (): void => {
    const p = levelNameProblem(doc, level.id, text);
    setProblem(p);
    if (!p) dispatch({ type: 'renameLevel', id: level.id, name: text });
  };
  return (
    <span className="editor-levels__rename">
      <input
        aria-label={`Name of ${level.name}`}
        value={text}
        maxLength={LAYOUT_LIMITS.nameMaxLength}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          keep();
        }}
        onBlur={() => {
          focused.current = false;
          keep();
        }}
      />
      {problem && (
        <span id={problemId} className="editor-field-error">
          {problem}
        </span>
      )}
    </span>
  );
}

/** FR-015: the level a deleted level's seats take instead. */
function DeleteLevel({
  doc,
  level,
  count,
  onDelete,
  onCancel,
}: {
  doc: EditorDoc;
  level: EdLevel;
  count: number;
  onDelete: (replacement: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const others = doc.levels.filter((l) => l.id !== level.id);
  const [to, setTo] = useState(others[0]?.id ?? '');
  const id = useId();
  return (
    <div role="group" aria-label={`Delete ${level.name}`} className="editor-levels__delete">
      <div className="field">
        <label htmlFor={id}>{`Its ${seats(count)} take`}</label>
        <select id={id} value={to} onChange={(e) => setTo(e.target.value)}>
          {others.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form__actions">
        <button type="button" className="btn btn--primary" onClick={() => onDelete(to)}>
          Delete level
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
