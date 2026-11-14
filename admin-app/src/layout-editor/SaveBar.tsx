import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import type { EditorDoc } from './editor-doc';

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
  | { kind: 'refused'; error: ApiError };

/**
 * Spec 039 FR-019 (research R16; T023): Save, "Saved", and a refusal placed where it is: a
 * `LAYOUT_FILE_INVALID` problem selects the section its path points at, a name refusal goes beside
 * the name box. A refused save never changes the document (it is not touched here).
 */
export function SaveBar({
  doc,
  dirty,
  onSave,
  onSelectSection,
  onNameProblem,
}: {
  doc: EditorDoc;
  dirty: boolean;
  /** Saves the document; throws the refusal. */
  onSave: () => Promise<void>;
  onSelectSection: (index: number) => void;
  onNameProblem: (message: string | null) => void;
}): React.ReactElement {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // "Saved" lasts until the next change.
  useEffect(() => {
    if (dirty) setStatus((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
  }, [dirty]);

  const save = async (): Promise<void> => {
    const parts = missingParts(doc);
    if (parts.length > 0) {
      setStatus({ kind: 'missing', parts });
      return;
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
          disabled={status.kind === 'saving'}
          onClick={() => void save()}
        >
          {status.kind === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {status.kind === 'saved' && <span className="editor-save__saved">Saved</span>}
      </div>
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
      {status.kind === 'refused' && <Refusal error={status.error} />}
    </div>
  );
}

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
