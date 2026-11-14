import { useEffect, useRef, useState } from 'react';
import type { EditorDoc } from './editor-doc';
import type { Selection } from './editor-state';

/**
 * Spec 039 US1 (walk feedback, 2026-11-14): how a layout is made, on the editor itself. The steps
 * open on a new layout and tick off as each is done; once the first section is made they fold
 * away (they open again on request). One line under them says what can be done with what is
 * selected now. Neither is shown read-only.
 */
export function Guide({
  doc,
  selection,
  zoomed,
}: {
  doc: EditorDoc;
  selection: Selection;
  zoomed: boolean;
}): React.ReactElement {
  const hasSections = doc.sections.length > 0;
  const [open, setOpen] = useState(!hasSections);
  // The first section folds the steps away; later ones leave them as the admin left them.
  const had = useRef(hasSections);
  useEffect(() => {
    if (hasSections && !had.current) setOpen(false);
    had.current = hasSections;
  }, [hasSections]);

  const leveled = doc.levels.length > 1 || doc.levels[0]?.name !== 'Standard';
  const steps: { done: boolean; text: string }[] = [
    {
      done: doc.floor.kind !== 'NONE',
      text: 'Pick a floor object (Court, End stage, Center stage or Ring) under Floor object, then drag its corners on the map to size it.',
    },
    {
      done: hasSections,
      text: 'Add a section: in Sections, press Add section, type its rows and seats per row (and a curve for a bowl), and press Generate. It appears in the middle of the map.',
    },
    {
      done: false,
      text: 'Drag the section into place, and drag the round handle above it to turn it toward the floor. Duplicate section (under Selection) makes the next one faster.',
    },
    {
      done: leveled,
      text: 'Give seats price levels: add levels under Price levels (Add level), then select sections (or, after double-clicking a section, rows and seats) and choose their level under Selection: Price level.',
    },
    { done: false, text: 'Name the layout at the top and press Save.' },
  ];

  return (
    <div className="editor-guide">
      <details
        className="editor-guide__steps"
        aria-label="How to make a layout"
        open={open}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>How to make a layout</summary>
        <ol>
          {steps.map((s) => (
            <li key={s.text} className={s.done ? 'editor-guide__step--done' : undefined}>
              {s.done && <span className="visually-hidden">Done: </span>}
              {s.text}
            </li>
          ))}
        </ol>
      </details>
      <p className="editor-guide__hint" data-testid="editor-hint">
        {hintFor(selection, zoomed, hasSections)}
      </p>
    </div>
  );
}

/** What can be done now, by what is selected. */
function hintFor(selection: Selection, zoomed: boolean, hasSections: boolean): string {
  if (zoomed) {
    return 'Click seats (Shift-click for more) or a row label (Shift-click another for a range of rows); Box select draws a box around seats. Then choose their level under Selection: Price level. Back to layout returns to the whole map.';
  }
  if (selection.kind === 'sections') {
    return 'Drag it to move it. Drag the round handle above it to turn it. Choose its level under Selection: Price level. Double-click it to see its seats. The arrow keys move it, and [ and ] turn it.';
  }
  if (selection.kind === 'floor') {
    return 'Drag the floor to move it; drag its corners to size it. Delete (the key, or Delete floor object under Selection) removes it.';
  }
  if (!hasSections) return 'Start with the steps above: a floor object, then a section.';
  return 'Click a section to select it (Shift-click for more). Drag empty space to move the map; scroll or use the zoom buttons to zoom.';
}
