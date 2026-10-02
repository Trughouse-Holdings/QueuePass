import { useEffect, useRef, useState } from 'react';
import { useAuth, type ApiClient } from '@queuepass/shared/web';

export type Load<T> =
  { kind: 'loading' } | { kind: 'ok'; data: T } | { kind: 'missing' } | { kind: 'unreachable' };

/** What an openapi-fetch call resolves to, reduced to the parts this hook reads. */
export interface Fetched<T> {
  data?: T;
  response: Response;
}

/**
 * Loads one page's data through the Backend API with the customer's own token (spec 003 FR-010;
 * research R4). `key` identifies what is being loaded; a new key starts a new load.
 *
 * - 2xx → `ok`
 * - 404 → `missing` ("no longer available")
 * - 401 → back through sign-in (the session expired)
 * - anything else, or no answer → `unreachable`
 */
export function useLoad<T>(key: string, load: (api: ApiClient) => Promise<Fetched<T>>): Load<T> {
  const { api, signIn } = useAuth();
  const [state, setState] = useState<Load<T>>({ kind: 'loading' });
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    void (async () => {
      try {
        const { data, response } = await loadRef.current(api);
        if (cancelled) return;
        if (response.ok) setState({ kind: 'ok', data: data as T });
        else if (response.status === 401) await signIn();
        else if (response.status === 404) setState({ kind: 'missing' });
        else setState({ kind: 'unreachable' });
      } catch {
        if (!cancelled) setState({ kind: 'unreachable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, signIn, key]);

  return state;
}
