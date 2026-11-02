import { useAuth } from './auth-provider.js';
import { LogoutButton } from './logout-button.js';

/**
 * Spec 001 FR-016: a plain explanation and a logout control, and nothing else. Issue #37: in the
 * shared theme's card, the explanation as the page's heading, with a theme button. It sits in the
 * page it is shown in; `RequireRole` gives it the theme's page layout when it is the whole page.
 */
export function WrongRole() {
  const { username } = useAuth();
  return (
    <div className="card">
      <h1 className="page-title">Your account can&apos;t use this app.</h1>
      {username && <p>You are signed in as {username}.</p>}
      <p>
        <LogoutButton className="btn btn--primary" />
      </p>
    </div>
  );
}
