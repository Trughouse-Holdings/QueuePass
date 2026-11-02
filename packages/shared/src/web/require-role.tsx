import type { ReactNode } from 'react';
import type { Role } from '../roles.js';
import { useAuth } from './auth-provider.js';
import { WrongRole } from './wrong-role.js';

/**
 * Admits only users holding `role` (spec 001 FR-016). The role is read from the access token
 * so the gate works before any API call; the Backend enforces the same role independently.
 */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { status, roles } = useAuth();
  if (status !== 'signed-in') return <p>Signing in…</p>;
  // Issue #37: the refusal is the whole page, so it gets the theme's page layout around it.
  if (!roles.includes(role)) {
    return (
      <div className="app">
        <main className="main">
          <WrongRole />
        </main>
      </div>
    );
  }
  return <>{children}</>;
}
