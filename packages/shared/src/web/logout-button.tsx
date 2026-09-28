import { useAuth } from './auth-provider.js';

/** Spec 001 FR-015: on every signed-in page. Ends the app's AND Keycloak's session. */
export function LogoutButton() {
  const { logout } = useAuth();
  return (
    <button type="button" onClick={() => void logout()}>
      Log out
    </button>
  );
}
