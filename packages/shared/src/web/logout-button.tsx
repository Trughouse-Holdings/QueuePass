import { useAuth } from './auth-provider.js';

/**
 * Spec 001 FR-015: on every signed-in page. Ends the app's AND Keycloak's session. In a top bar it
 * needs no class (the theme styles `.topbar button`); elsewhere `className` gives it a theme
 * button's classes (issue #37).
 */
export function LogoutButton({ className }: { className?: string } = {}) {
  const { logout } = useAuth();
  return (
    <button type="button" className={className} onClick={() => void logout()}>
      Log out
    </button>
  );
}
