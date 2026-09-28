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
  if (!roles.includes(role)) return <WrongRole />;
  return <>{children}</>;
}
