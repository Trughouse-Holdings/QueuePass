import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  LAYOUT_LIMITS,
  type LayoutDetail,
  type LayoutSummary,
  type Location,
} from '@queuepass/shared';
import { LayoutPreview } from '@queuepass/shared/web';
import { ApiError } from '../api/client';
import {
  deleteVenueLayout,
  duplicateVenueLayout,
  getVenueLayout,
  importVenueLayout,
  listVenueLayouts,
  updateVenueLayout,
} from '../api/layouts';
import { ErrorBanner } from './ErrorBanner';

const count = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Any failure as an ApiError, so ErrorBanner can show it. */
const asApiError = (err: unknown): ApiError =>
  err instanceof ApiError
    ? err
    : new ApiError(0, {
        error: { code: 'VALIDATION_FAILED', message: "Can't reach the QueuePass service." },
      });

/** A file's text (`File.text`, else a FileReader). */
const readText = (file: File): Promise<string> =>
  typeof file.text === 'function'
    ? file.text()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });

/** The seats a layout file describes (each row's `seats.count`); 0 when it names none. */
const seatsInFile = (file: Record<string, unknown>): number => {
  let seats = 0;
  for (const section of Array.isArray(file.sections) ? file.sections : []) {
    for (const row of Array.isArray(section?.rows) ? section.rows : []) {
      const count = Number(row?.seats?.count);
      if (Number.isInteger(count) && count > 0) seats += count;
    }
  }
  return seats;
};

/**
 * A chosen layout file, read before it is sent: at most 4 MB and JSON, with the seats it
 * describes. The Backend still checks the file itself (`LAYOUT_FILE_INVALID`).
 */
export async function readLayoutFile(
  file: File,
): Promise<{ file: Record<string, unknown>; seats: number } | { problem: string }> {
  if (file.size > LAYOUT_LIMITS.maxImportBytes) {
    return { problem: `${file.name} is larger than 4 MB.` };
  }
  try {
    const parsed = JSON.parse(await readText(file)) as Record<string, unknown>;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return { file: parsed, seats: seatsInFile(parsed) };
  } catch {
    return { problem: `${file.name} is not a layout file: it is not JSON.` };
  }
}

/** A refusal of the import, or a file that could not be read as one. */
export type ImportError = { kind: 'api'; error: ApiError } | { kind: 'local'; message: string };

/**
 * Spec 038 US1 (FR-004–FR-009; research R15): the venue page's Layouts card, in place of `007`'s
 * single layout. Each layout with its counts, the scheduled events using it, whether it is locked
 * (sold or held seats at one of them; the API names no event there, a refused change does), and a
 * preview of its map; Import layout file (the only way to add a layout: the layout editor and
 * section lines were removed on 2026-11-19), and per layout Rename, Duplicate and Delete. Each refusal is shown beside the control that was used, in the Backend's
 * words, and nothing typed is lost. `onLayouts` hears every list loaded, for the venue's capacity.
 */
export function LayoutsCard({
  venue,
  onLayouts,
}: {
  venue: Location;
  onLayouts?: (layouts: LayoutSummary[]) => void;
}): React.ReactElement {
  const [layouts, setLayouts] = useState<LayoutSummary[] | null | 'unavailable'>(null);
  const [details, setDetails] = useState<Record<string, LayoutDetail>>({});
  const [file, setFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<ImportError | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const onLayoutsRef = useRef(onLayouts);
  onLayoutsRef.current = onLayouts;
  const fileId = useId();
  const problemsId = useId();

  const load = useCallback(async () => {
    try {
      const list = await listVenueLayouts(venue.id);
      setLayouts(list);
      onLayoutsRef.current?.(list);
      const loaded = await Promise.all(list.map((l) => getVenueLayout(l.id).catch(() => null)));
      setDetails(Object.fromEntries(loaded.filter((d) => d !== null).map((d) => [d.id, d])));
    } catch {
      setLayouts('unavailable');
    }
  }, [venue.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one write at a time; reloads the list after it. Returns whether it went through. */
  const run = useCallback(
    async (action: () => Promise<unknown>, fail: (err: ApiError) => void): Promise<boolean> => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      try {
        await action();
        await load();
        return true;
      } catch (err) {
        fail(asApiError(err));
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [load],
  );

  async function importFile(): Promise<void> {
    if (!file) return;
    setImportError(null);
    const read = await readLayoutFile(file);
    if ('problem' in read) {
      setImportError({ kind: 'local', message: read.problem });
      return;
    }
    await run(
      () => importVenueLayout(venue.id, { file: read.file as never }),
      (error) => setImportError({ kind: 'api', error }),
    );
  }

  return (
    <section className="card" aria-labelledby="layouts-heading">
      <h2 id="layouts-heading">Layouts</h2>
      {layouts === null ? (
        <p className="loading">Loading layouts…</p>
      ) : layouts === 'unavailable' ? (
        <p className="note">The layouts are unavailable right now.</p>
      ) : layouts.length === 0 ? (
        <p className="note">No layouts yet.</p>
      ) : (
        <div className="layout-list">
          {layouts.map((l) => (
            <LayoutItem key={l.id} layout={l} detail={details[l.id]} busy={busy} run={run} />
          ))}
        </div>
      )}

      <div className="field">
        <label htmlFor={fileId}>Layout file</label>
        <input
          id={fileId}
          type="file"
          accept=".json,application/json"
          aria-describedby={importError ? problemsId : undefined}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setImportError(null);
          }}
        />
        <span className="field__hint">
          A layout file (JSON, format 1) of up to 4 MB: its sections, rows, seats and price levels.
        </span>
      </div>
      {importError && <ImportProblems id={problemsId} error={importError} />}
      <div className="form__actions">
        <button
          type="button"
          className="btn"
          disabled={!file || busy}
          onClick={() => void importFile()}
        >
          Import layout file
        </button>
      </div>
    </section>
  );
}

/** The import's problems under the file input, each with its place in the file (R5). */
export function ImportProblems({
  id,
  error,
}: {
  id: string;
  error: ImportError;
}): React.ReactElement {
  if (error.kind === 'local') {
    return (
      <div id={id} role="alert" className="banner banner--error">
        <div className="banner__body">
          <strong>Could not import the layout</strong>
          <p>{error.message}</p>
        </div>
      </div>
    );
  }
  const details = error.error.details as
    | { problems?: { path: string; message: string }[]; more?: number; fields?: string[] }
    | undefined;
  const problems = error.error.code === 'LAYOUT_FILE_INVALID' ? (details?.problems ?? []) : [];
  const more = details?.more ?? 0;
  // A refusal of the request itself (`VALIDATION_FAILED`) lists its fields, as ErrorBanner does.
  const fields =
    error.error.code === 'VALIDATION_FAILED' && Array.isArray(details?.fields)
      ? details.fields
      : [];
  return (
    <div id={id} role="alert" className="banner banner--error">
      <div className="banner__body">
        <strong>Could not import the layout</strong>
        <p>{error.error.envelope.error.message}</p>
        {problems.length > 0 && (
          <ul>
            {problems.map((p) => (
              <li key={`${p.path} ${p.message}`}>{`${p.message} (${p.path})`}</li>
            ))}
            {more > 0 && <li>{`and ${more} more`}</li>}
          </ul>
        )}
        {fields.length > 0 && (
          <ul>
            {fields.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One layout: its counts, lock, preview, and its own controls and refusals. */
function LayoutItem({
  layout,
  detail,
  busy,
  run,
}: {
  layout: LayoutSummary;
  detail: LayoutDetail | undefined;
  busy: boolean;
  run: (action: () => Promise<unknown>, fail: (err: ApiError) => void) => Promise<boolean>;
}): React.ReactElement {
  const headingId = useId();
  const nameId = useId();
  const [error, setError] = useState<ApiError | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const { name } = layout;

  const act = async (action: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    return run(action, setError);
  };

  const rename = async (to: string) => {
    if (await act(() => updateVenueLayout(layout.id, { name: to.trim() }))) setRenaming(null);
  };
  const remove = () => {
    if (!window.confirm(`Delete the layout "${name}"? This can't be undone.`)) return;
    void act(() => deleteVenueLayout(layout.id));
  };

  return (
    <article className="layout-item" aria-labelledby={headingId}>
      <h3 id={headingId}>{name}</h3>
      <p>
        {`${count(layout.seatCount, 'seat')} · ${count(layout.sectionCount, 'section')} · ` +
          `${count(layout.levelCount, 'price level')} · used by ${count(layout.eventsUsing, 'event')}`}
      </p>
      {layout.locked && <p className="note">Locked: seats are sold or held</p>}
      {detail ? <LayoutPreview layout={detail} /> : <p className="loading">Loading the preview…</p>}

      {renaming !== null && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void rename(renaming);
          }}
        >
          <div className="field">
            <label htmlFor={nameId}>{`New name for ${name}`}</label>
            <input
              id={nameId}
              value={renaming}
              maxLength={LAYOUT_LIMITS.nameMaxLength}
              onChange={(e) => setRenaming(e.target.value)}
            />
          </div>
          <div className="form__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              Save name
            </button>
            <button type="button" className="btn" onClick={() => setRenaming(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="form__actions">
        <button
          type="button"
          className="btn"
          aria-label={`Rename ${name}`}
          onClick={() => {
            setError(null);
            setRenaming(name);
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className="btn"
          aria-label={`Duplicate ${name}`}
          disabled={busy}
          onClick={() => void act(() => duplicateVenueLayout(layout.id))}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="btn"
          aria-label={`Delete ${name}`}
          disabled={busy}
          onClick={remove}
        >
          Delete
        </button>
      </div>
      {error && <ErrorBanner error={error} title={`Could not change ${name}`} />}
    </article>
  );
}
