import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  LAYOUT_LIMITS,
  type Event,
  type LayoutDetail,
  type LayoutSummary,
  type Location,
} from '@queuepass/shared';
import { LayoutPreview } from '@queuepass/shared/web';
import { ApiError } from '../api/client';
import {
  createVenueLayout,
  deleteVenueLayout,
  duplicateVenueLayout,
  getVenueLayout,
  importVenueLayout,
  listVenueLayouts,
  updateVenueLayout,
} from '../api/layouts';
import { ErrorBanner } from './ErrorBanner';
import {
  NEW_LEVEL,
  SectionLines,
  toLinesInput,
  totalSeats,
  type LevelLine,
  type SectionLine,
} from './SectionLines';

/** An event at the venue, with the layout it uses (contract 2.0.0 `Event.layoutId`). */
type VenueEvent = Event & { layoutId?: string | null };

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

/** A refusal of the import, or a file that could not be read as one. */
type ImportError = { kind: 'api'; error: ApiError } | { kind: 'local'; message: string };

/** The section-line form, for a new layout or for a LINES layout being edited. */
interface LinesDraft {
  name: string;
  levels: LevelLine[];
  lines: SectionLine[];
}

/** A LINES layout as lines again: its levels by rank, its sections in order (R6). */
const draftOf = (layout: LayoutDetail): LinesDraft => {
  const levelName = new Map(layout.levels.map((l) => [l.id, l.name]));
  return {
    name: layout.name,
    levels: layout.levels.map((l) => ({ name: l.name, color: l.color })),
    lines: layout.sections.map((s) => ({
      name: s.name,
      rows: String(s.rowCount),
      seatsPerRow: String(s.seatCount / s.rowCount),
      level: levelName.get(s.levelId) ?? '',
    })),
  };
};

/**
 * Spec 038 US1 (FR-004–FR-009; research R15): the venue page's Layouts card, in place of `007`'s
 * single layout. Each layout with its counts, the scheduled events using it, whether it is locked
 * (sold or held seats at one of them), and a preview of its map; Import layout file, New layout
 * from section lines, and per layout Rename, Edit section lines (a layout made from lines only),
 * Duplicate and Delete. Each refusal is shown beside the control that was used, in the Backend's
 * words, and nothing typed is lost. `onLayouts` hears every list loaded, for the venue's capacity.
 */
export function LayoutsCard({
  venue,
  events,
  onLayouts,
}: {
  venue: Location;
  events: VenueEvent[];
  onLayouts?: (layouts: LayoutSummary[]) => void;
}): React.ReactElement {
  const [layouts, setLayouts] = useState<LayoutSummary[] | null | 'unavailable'>(null);
  const [details, setDetails] = useState<Record<string, LayoutDetail>>({});
  const [adding, setAdding] = useState<LinesDraft | null>(null);
  const [addError, setAddError] = useState<ApiError | null>(null);
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
    if (file.size > LAYOUT_LIMITS.maxImportBytes) {
      setImportError({ kind: 'local', message: `${file.name} is larger than 4 MB.` });
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(await readText(file)) as Record<string, unknown>;
    } catch {
      setImportError({
        kind: 'local',
        message: `${file.name} is not a layout file: it is not JSON.`,
      });
      return;
    }
    await run(
      () => importVenueLayout(venue.id, { file: parsed as never }),
      (error) => setImportError({ kind: 'api', error }),
    );
  }

  async function saveNew(draft: LinesDraft): Promise<void> {
    setAddError(null);
    const ok = await run(
      () => createVenueLayout(venue.id, toLinesInput(draft.name, draft.levels, draft.lines)),
      setAddError,
    );
    if (ok) setAdding(null);
  }

  const lockedAt = (layoutId: string): string[] =>
    events.filter((e) => e.layoutId === layoutId && e.status === 'SCHEDULED').map((e) => e.name);

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
            <LayoutItem
              key={l.id}
              layout={l}
              detail={details[l.id]}
              lockedAt={lockedAt(l.id)}
              busy={busy}
              run={run}
            />
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
        {!adding && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setAddError(null);
              setAdding({ name: '', levels: [NEW_LEVEL], lines: [] });
            }}
          >
            New layout from section lines
          </button>
        )}
      </div>
      {adding && (
        <LinesForm
          label="New layout from section lines"
          draft={adding}
          onDraft={(update) => setAdding((d) => (d ? update(d) : d))}
          error={addError}
          busy={busy}
          onSave={() => void saveNew(adding)}
          onCancel={() => setAdding(null)}
        />
      )}
    </section>
  );
}

/** The import's problems under the file input, each with its place in the file (R5). */
function ImportProblems({ id, error }: { id: string; error: ImportError }): React.ReactElement {
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
    { problems?: { path: string; message: string }[]; more?: number } | undefined;
  const problems = error.error.code === 'LAYOUT_FILE_INVALID' ? (details?.problems ?? []) : [];
  const more = details?.more ?? 0;
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
      </div>
    </div>
  );
}

/** One layout: its counts, lock, preview, and its own controls and refusals. */
function LayoutItem({
  layout,
  detail,
  lockedAt,
  busy,
  run,
}: {
  layout: LayoutSummary;
  detail: LayoutDetail | undefined;
  lockedAt: string[];
  busy: boolean;
  run: (action: () => Promise<unknown>, fail: (err: ApiError) => void) => Promise<boolean>;
}): React.ReactElement {
  const headingId = useId();
  const nameId = useId();
  const [error, setError] = useState<ApiError | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editing, setEditing] = useState<LinesDraft | null>(null);
  const { name } = layout;

  const act = async (action: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    return run(action, setError);
  };

  const rename = async (to: string) => {
    if (await act(() => updateVenueLayout(layout.id, { name: to.trim() }))) setRenaming(null);
  };
  const saveLines = async (draft: LinesDraft) => {
    const ok = await act(() =>
      updateVenueLayout(layout.id, toLinesInput(draft.name, draft.levels, draft.lines)),
    );
    if (ok) setEditing(null);
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
      {layout.locked && (
        <p className="note">
          {lockedAt.length > 0
            ? `Locked: seats sold at ${lockedAt.join(', ')}`
            : 'Locked: seats are sold or held at an event using it'}
        </p>
      )}
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
        {layout.source === 'LINES' && detail && (
          <button
            type="button"
            className="btn"
            aria-label={`Edit section lines of ${name}`}
            onClick={() => {
              setError(null);
              setEditing(draftOf(detail));
            }}
          >
            Edit section lines
          </button>
        )}
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
      {error && !editing && <ErrorBanner error={error} title={`Could not change ${name}`} />}

      {editing && (
        <LinesForm
          label={`Section lines of ${name}`}
          draft={editing}
          onDraft={(update) => setEditing((d) => (d ? update(d) : d))}
          error={error}
          busy={busy}
          onSave={() => void saveLines(editing)}
          onCancel={() => setEditing(null)}
        />
      )}
    </article>
  );
}

/** A layout's name, levels and section lines, with Save layout and its refusal under it. */
function LinesForm({
  label,
  draft,
  onDraft,
  error,
  busy,
  onSave,
  onCancel,
}: {
  label: string;
  draft: LinesDraft;
  /** Each change as an update of the draft as it is then: a level's rename changes two parts. */
  onDraft: (update: (draft: LinesDraft) => LinesDraft) => void;
  error: ApiError | null;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const nameId = useId();
  const seats = totalSeats(draft.lines);
  return (
    <form
      className="form"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="field">
        <label htmlFor={nameId}>Layout name</label>
        <input
          id={nameId}
          value={draft.name}
          maxLength={LAYOUT_LIMITS.nameMaxLength}
          onChange={(e) => {
            const name = e.target.value;
            onDraft((d) => ({ ...d, name }));
          }}
        />
      </div>
      <SectionLines
        levels={draft.levels}
        onLevelsChange={(levels) => onDraft((d) => ({ ...d, levels }))}
        lines={draft.lines}
        onChange={(lines) => onDraft((d) => ({ ...d, lines }))}
      />
      <p className="note">{`Total: ${count(seats, 'seat')}`}</p>
      {error && <ErrorBanner error={error} title="Could not save the layout" />}
      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save layout'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
