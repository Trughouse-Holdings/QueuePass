// @queuepass/shared/web — sign-in and the stub pages shared by all three front ends
// (spec 001 research R9). React is a peer dependency; the Backend never imports this.
export { AuthProvider, createUserManager, useAuth } from './auth-provider.js';
export type { Auth, AuthStatus, AuthProviderProps, UserManagerLike } from './auth-provider.js';
export { RequireRole } from './require-role.js';
export { LogoutButton } from './logout-button.js';
export { HelloPage } from './hello-page.js';
export type { GreetingPath } from './hello-page.js';
export { WrongRole } from './wrong-role.js';
export { ServiceUnreachable } from './service-unreachable.js';
export { apiBaseUrl, createApiClient } from './api-client.js';
export type { ApiClient } from './api-client.js';
