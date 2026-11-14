import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, RequireRole } from '@queuepass/shared/web';
import { routes } from './App';
import { AppRouter } from './router';
// Spec 012 (Constitution VII): the one shared theme first; this app's own screens after it.
import '@queuepass/shared/theme.css';
import './styles.css';

// Spec 001: sign in with Keycloak before anything renders; only QueuePass Admins get in.
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AuthProvider
      authority={import.meta.env.VITE_OIDC_AUTHORITY}
      clientId={import.meta.env.VITE_OIDC_CLIENT_ID}
    >
      <RequireRole role="queuepass-admin">
        <AppRouter routes={routes} />
      </RequireRole>
    </AuthProvider>
  </StrictMode>,
);
