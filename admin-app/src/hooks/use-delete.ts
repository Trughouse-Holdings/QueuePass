import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';

export interface NoticeState {
  notice: { kind: 'success' | 'info'; text: string };
}

/**
 * Confirm, delete, then navigate or show why not (spec 002 FR-026, FR-027, FR-029; research
 * R4, R5). Delete is permanent, so nothing is sent unless the admin confirms.
 */
export function useDelete({
  kind,
  name,
  run,
  listPath,
}: {
  kind: 'venue' | 'event';
  name: string;
  run: () => Promise<void>;
  listPath: string;
}): { remove: () => Promise<void>; deleting: boolean; error: ApiError | null } {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // A ref, not state: a second click in the same tick must see the first one.
  const inFlight = useRef(false);

  const remove = useCallback(async () => {
    if (inFlight.current) return;
    if (!window.confirm(`Delete the ${kind} "${name}"? This cannot be undone.`)) return;

    inFlight.current = true;
    setDeleting(true);
    setError(null);
    const go = (notice: NoticeState['notice']) => navigate(listPath, { state: { notice } });

    try {
      await run();
      go({ kind: 'success', text: `Deleted "${name}".` });
    } catch (err) {
      inFlight.current = false;
      setDeleting(false);
      if (err instanceof ApiError && err.status === 404) {
        // Someone else deleted it first: the list page fetches fresh on arrival.
        go({ kind: 'info', text: `"${name}" no longer exists. The list has been refreshed.` });
      } else if (err instanceof ApiError) {
        setError(err);
      } else {
        setError(
          new ApiError(0, {
            error: { code: 'VALIDATION_FAILED', message: "Can't reach the QueuePass service." },
          }),
        );
      }
    }
  }, [kind, name, run, listPath, navigate]);

  return { remove, deleting, error };
}
