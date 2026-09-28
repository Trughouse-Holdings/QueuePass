import { useAuth } from './auth-provider.js';
import { LogoutButton } from './logout-button.js';

/** Spec 001 FR-016: a plain explanation and a logout control, and nothing else. */
export function WrongRole() {
  const { username } = useAuth();
  return (
    <main>
      <p>Your account can&apos;t use this app.</p>
      {username && <p>You are signed in as {username}.</p>}
      <LogoutButton />
    </main>
  );
}
