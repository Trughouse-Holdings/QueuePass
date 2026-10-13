import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, RequireRole } from '@queuepass/shared/web';
import { App } from './App';
// Spec 012 (Constitution VII): the one shared theme, the same look as the Admin app, first;
// this app's own screens after it.
import '@queuepass/shared/theme.css';
import './styles.css';

// Spec 001: sign in with Keycloak before anything renders; only customers get in.
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AuthProvider
      authority={import.meta.env.VITE_OIDC_AUTHORITY}
      clientId={import.meta.env.VITE_OIDC_CLIENT_ID}
    >
      <RequireRole role="customer">
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </RequireRole>
    </AuthProvider>
  </StrictMode>,
);
