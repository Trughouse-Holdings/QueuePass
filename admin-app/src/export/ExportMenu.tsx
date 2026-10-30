import { useId, useRef, useState } from 'react';
import { save } from './save';
import type { ExportTable } from './table';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

/** The three choices (FR-001): the button, and the format's name in messages. */
const FORMATS: { ext: ExportFormat; button: string; name: string }[] = [
  { ext: 'csv', button: 'CSV', name: 'CSV' },
  { ext: 'xlsx', button: 'Excel (XLSX)', name: 'Excel file' },
  { ext: 'pdf', button: 'PDF', name: 'PDF' },
];

/** Research R2: each writer, and the library behind it, loads on first use only. */
const WRITERS: Record<ExportFormat, () => Promise<(table: ExportTable) => Blob | Promise<Blob>>> = {
  csv: () => import('./csv').then((m) => m.toCsv),
  xlsx: () => import('./xlsx').then((m) => m.toXlsx),
  pdf: () => import('./pdf').then((m) => m.toPdf),
};

/**
 * FR-014: let the browser paint "Preparing…" before a writer runs; a large PDF is drawn in one
 * synchronous stretch (research R12).
 */
const afterPaint = (): Promise<void> =>
  new Promise((resolve) =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => setTimeout(resolve, 0))
      : setTimeout(resolve, 0),
  );

export interface ExportMenuProps {
  /** The group's accessible name: "Download the attendee list". */
  label: string;
  /** The page's own data as a table, at the click (FR-003). */
  makeTable: () => ExportTable;
  fileName: (ext: ExportFormat) => string;
  /** Shown with the choices and describing each (FR-011). */
  note?: string;
}

/**
 * Spec 023 FR-001, FR-002, FR-011, FR-014, FR-015 (research R11): a native disclosure, so it
 * opens by keyboard and is announced without script; one file at a time, said while it is made,
 * and a failure named by format. Shared theme classes only (Constitution VII).
 */
export function ExportMenu({ label, makeTable, fileName, note }: ExportMenuProps) {
  const noteId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // State updates are not immediate; this blocks a second start from the same event loop turn.
  const running = useRef(false);

  const download = async (format: (typeof FORMATS)[number]) => {
    if (running.current) return;
    running.current = true;
    setBusy(format.name);
    setFailed(null);
    try {
      const write = await WRITERS[format.ext]();
      await afterPaint();
      save(await write(makeTable()), fileName(format.ext));
    } catch {
      setFailed(format.name);
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  return (
    <details>
      <summary className="btn">
        Download <span aria-hidden="true">▾</span>
      </summary>
      <div role="group" aria-label={label} className="form__actions">
        {FORMATS.map((f) => (
          <button
            key={f.ext}
            type="button"
            className="btn btn--ghost"
            disabled={busy !== null}
            aria-describedby={note ? noteId : undefined}
            onClick={() => void download(f)}
          >
            {f.button}
          </button>
        ))}
      </div>
      {note && (
        <p id={noteId} className="note">
          {note}
        </p>
      )}
      <p role="status" className="note">
        {busy ? `Preparing the ${busy}…` : ''}
      </p>
      {failed && (
        <p role="alert" className="banner banner--error">
          {`Couldn't make the ${failed}. Try again.`}
        </p>
      )}
    </details>
  );
}
