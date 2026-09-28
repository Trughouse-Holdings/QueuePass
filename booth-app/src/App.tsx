import {
  AuthProvider,
  HelloPage,
  LogoutButton,
  RequireRole,
  type UserManagerLike,
} from '@queuepass/shared/web';

/**
 * QueuePass Ticket Booth: a stub front end (spec 001, Constitution VII). Sign-in, a hello-world page from the
 * Backend, and logout. Admits only the gate-agent role.
 */
export function App({ userManager }: { userManager?: UserManagerLike }) {
  return (
    <AuthProvider
      authority={import.meta.env.VITE_OIDC_AUTHORITY}
      clientId={import.meta.env.VITE_OIDC_CLIENT_ID}
      userManager={userManager}
    >
      <RequireRole role="gate-agent">
        <header>
          <p>QueuePass Ticket Booth</p>
          <LogoutButton />
        </header>
        <main>
          <HelloPage greetingPath="/hello/booth" />
        </main>
      </RequireRole>
    </AuthProvider>
  );
}
