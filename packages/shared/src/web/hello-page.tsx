import { useEffect, useState } from 'react';
import type { components } from '../api-schema.js';
import { useAuth } from './auth-provider.js';
import { ServiceUnreachable } from './service-unreachable.js';
import { WrongRole } from './wrong-role.js';

type Hello = components['schemas']['Hello'];
export type GreetingPath = '/hello/admin' | '/hello/customer' | '/hello/booth';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; hello: Hello }
  | { kind: 'unreachable' }
  | { kind: 'forbidden' };

/**
 * Spec 001 FR-014: the hello-world page. The greeting comes from the Backend, called with the
 * user's own token, which proves the whole sign-in chain works end to end.
 */
export function HelloPage({ greetingPath }: { greetingPath: GreetingPath }) {
  const { api, signIn } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, response } = await api.GET(greetingPath);
        if (cancelled) return;
        if (data) setState({ kind: 'ok', hello: data });
        else if (response.status === 401) await signIn();
        else if (response.status === 403) setState({ kind: 'forbidden' });
        else setState({ kind: 'unreachable' });
      } catch {
        if (!cancelled) setState({ kind: 'unreachable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, signIn, greetingPath]);

  switch (state.kind) {
    case 'loading':
      return <p>Loading…</p>;
    case 'unreachable':
      return <ServiceUnreachable />;
    case 'forbidden':
      return <WrongRole />;
    case 'ok':
      return (
        <section>
          <h1>{state.hello.appName}</h1>
          <p>{state.hello.message}</p>
        </section>
      );
  }
}
