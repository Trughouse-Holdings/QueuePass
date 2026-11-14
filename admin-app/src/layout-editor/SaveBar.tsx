import { useEffect, useId, useState } from 'react';
import { LAYOUT_LIMITS } from '@queuepass/shared';
import { ApiError } from '../api/client';
import type { EditorDoc } from './editor-doc';
import { warningsOf } from './overlap';

/** A refusal's problem: where in the body, and what. */
export interface Problem {
  path: string;
  message: string;
}

/** R16: the section a problem's path points at (`sections[3].rows[1]…` → 3), or none. */
export const sectionIndexOf = (path: string): number | null => {
  const m = /^sections\[(\d+)\]/.exec(path);
  return m ? Number(m[1]) : null;
};

/** What stops a save before it is sent: the save names what is missing (edge case). */
export function missingParts(doc: EditorDoc): string[] {
  const missing: string[] = [];
  if (doc.name.trim() === '') missing.push('Name the layout');
  if (doc.sections.length === 0) missing.push('Add at least one section');
  return missing;
}

/** Any failure as an ApiError, so it can be shown. */
export const asApiError = (err: unknown): ApiError =>
  err instanceof ApiError
    ? err
    : new ApiError(0, {
        error: { code: 'VALIDATION_FAILED', message: "Can't reach the QueuePass service." },
      });

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'missing'; parts: string[] }
  | { kind: 'warnings'; messages: string[] }
  | { kind: 'refused'; error: ApiError };

/**
 * Spec 039 FR-019 (research R16; T023): Save, "Saved", and a refusal placed where it is: a
 * `LAYOUT_FILE_INVALID` problem selects the section its path points at, a name refusal goes beside
 * the name box. A refused save never changes the document (it is not touched here). Before
 * sending, the warnings that do not block a save (overlapping sections, levels with no seats) are
 * listed with Save anyway and Go back, the overlapping sections outlined on the map (FR-020, R15).
 */
export function SaveBar({
  doc,
  dirty,
  onSave,
  onSelectSection,
  onNameProblem,
  onWarned,
  onSaveAsNew,
  onReload,
  initiallySaved = false,
  blocked,
}: {
  doc: EditorDoc;
  dirty: boolean;
  /** Saves the document; throws the refusal. */
  onSave: () => Promise<void>;
  onSelectSection: (index: number) => void;
  onNameProblem: (message: string | null) => void;
  /** Hears the sections to outline as overlapping (none once the save goes). */
  onWarned?: (sections: Set<string>) => void;
  /** FR-023, FR-024: saves the document as a new layout under `name`; throws the refusal. */
  onSaveAsNew?: (name: string) => Promise<void>;
  /** FR-024: reads the layout again, the changes thrown away. */
  onReload?: () => Promise<void>;
  /** Review B4: the editor opened on a layout it has just made, so it starts saved. */
  initiallySaved?: boolean;
  /** Why Save can't be used now (shown beside it, with Reload), or nothing. */
  blocked?: string;
}): React.ReactElement {
  const [status, setStatus] = useState<Status>({ kind: initiallySaved ? 'saved' : 'idle' });
  const [copyName, setCopyName] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<ApiError | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const copyId = useId();
  const copyErrorId = useId();

  const saveCopy = async (name: string): Promise<void> => {
    if (!onSaveAsNew) return;
    setCopyError(null);
    setCopyBusy(true);
    try {
      await onSaveAsNew(name.trim());
    } catch (err) {
      setCopyError(asApiError(err));
    } finally {
      setCopyBusy(false);
    }
  };

  const reload = async (): Promise<void> => {
    if (!onReload || !window.confirm(RELOAD)) return;
    try {
      await onReload();
      setStatus({ kind: 'idle' });
      setCopyName(null);
    } catch (err) {
      setStatus({ kind: 'refused', error: asApiError(err) });
    }
  };

  // "Saved" lasts until the next change.
  useEffect(() => {
    if (dirty) setStatus((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
  }, [dirty]);

  const save = async (anyway = false): Promise<void> => {
    const parts = missingParts(doc);
    if (parts.length > 0) {
      setStatus({ kind: 'missing', parts });
      return;
    }
    if (!anyway) {
      const warnings = warningsOf(doc);
      onWarned?.(warnings.sections);
      if (warnings.messages.length > 0) {
        setStatus({ kind: 'warnings', messages: warnings.messages });
        return;
      }
    }
    setStatus({ kind: 'saving' });
    onNameProblem(null);
    try {
      await onSave();
      setStatus({ kind: 'saved' });
    } catch (err) {
      const error = asApiError(err);
      setStatus({ kind: 'refused', error });
      if (error.code === 'LAYOUT_NAME_TAKEN') onNameProblem(error.message);
      const problems = problemsOf(error);
      const first = problems.map((p) => sectionIndexOf(p.path)).find((i) => i !== null);
      if (first !== undefined && first !== null) onSelectSection(first);
      const named = problems.find((p) => p.path === 'name');
      if (named) onNameProblem(named.message);
    }
  };

  return (
    <div className="editor-save">
      <div className="editor-save__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={status.kind === 'saving' || blocked !== undefined}
          onClick={() => void save()}
        >
          {status.kind === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {status.kind === 'saved' && !blocked && <span className="editor-save__saved">Saved</span>}
      </div>
      {blocked && (
        <div role="alert" className="banner banner--conflict">
          <div className="banner__body">
            <strong>{blocked}</strong>
            {onReload && (
              <div className="form__actions">
                <button type="button" className="btn" onClick={() => void reload()}>
                  Reload
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {status.kind === 'missing' && (
        <div role="alert" className="banner banner--error">
          <div className="banner__body">
            <strong>The layout can't be saved yet</strong>
            <ul>
              {status.parts.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {status.kind === 'warnings' && (
        <div role="group" aria-label="Before saving" className="banner banner--conflict">
          <div className="banner__body">
            <strong>Before saving</strong>
            <ul>
              {status.messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <div className="form__actions">
              <button type="button" className="btn btn--primary" onClick={() => void save(true)}>
                Save anyway
              </button>
              <button type="button" className="btn" onClick={() => setStatus({ kind: 'idle' })}>
                Go back
              </button>
            </div>
          </div>
        </div>
      )}
      {status.kind === 'refused' && <Refusal error={status.error} />}
      {status.kind === 'refused' && OFFER_COPY.has(status.error.code) && (
        <div className="form__actions">
          {onSaveAsNew && copyName === null && (
            <button
              type="button"
              className="btn"
              onClick={() => setCopyName(`${doc.name.trim()} (copy)`)}
            >
              Save as a new layout
            </button>
          )}
          {onReload && status.error.code === 'LAYOUT_CHANGED' && (
            <button type="button" className="btn" onClick={() => void reload()}>
              Reload
            </button>
          )}
        </div>
      )}
      {copyName !== null && (
        <form
          className="form"
          aria-label="Save as a new layout"
          onSubmit={(e) => {
            e.preventDefault();
            void saveCopy(copyName);
          }}
        >
          <div className="field">
            <label htmlFor={copyId}>Name of the new layout</label>
            <input
              id={copyId}
              value={copyName}
              maxLength={LAYOUT_LIMITS.nameMaxLength}
              aria-invalid={copyError ? true : undefined}
              aria-describedby={copyError ? copyErrorId : undefined}
              onChange={(e) => setCopyName(e.target.value)}
            />
            {copyError && (
              <span id={copyErrorId} className="editor-field-error">
                {copyError.message}
              </span>
            )}
          </div>
          <div className="form__actions">
            <button type="submit" className="btn btn--primary" disabled={copyBusy}>
              Save new layout
            </button>
            <button type="button" className="btn" onClick={() => setCopyName(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** R9: the refusals after which the work can still be kept as a new layout. */
const OFFER_COPY = new Set(['LAYOUT_CHANGED', 'LAYOUT_IN_USE']);

/** R9: the question before Reload throws the changes away. */
export const RELOAD = 'Reload the layout? Your changes will be lost.';

const problemsOf = (error: ApiError): Problem[] =>
  error.code === 'LAYOUT_FILE_INVALID'
    ? ((error.details?.problems as Problem[] | undefined) ?? [])
    : [];

/** The refusal in the Backend's words, with each problem. */
function Refusal({ error }: { error: ApiError }): React.ReactElement {
  const problems = problemsOf(error);
  const more = (error.details?.more as number | undefined) ?? 0;
  return (
    <div role="alert" className="banner banner--error" data-code={error.code}>
      <div className="banner__body">
        <strong>Could not save the layout</strong>
        <p>{error.message}</p>
        {problems.length > 0 && (
          <ul>
            {problems.map((p) => (
              <li key={`${p.path} ${p.message}`}>{p.message}</li>
            ))}
            {more > 0 && <li>{`and ${more} more`}</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
