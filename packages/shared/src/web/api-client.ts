import createClient, { type Client } from 'openapi-fetch';
import type { paths } from '../api-schema.js';

export type ApiClient = Client<paths>;

/** Where every front end finds the Backend: VITE_API_BASE_URL, baked in at build time. */
export function apiBaseUrl(): string {
  return import.meta.env?.VITE_API_BASE_URL ?? 'http://localhost:3000';
}

/**
 * The only network path from a front end to data (Constitution I). Typed by the schema
 * generated from contracts/openapi.yaml, so a call that disagrees with the contract fails
 * the type check (research R8). Every request carries the signed-in user's own token (FR-012).
 */
export function createApiClient(
  baseUrl: string,
  getAccessToken: () => string | undefined,
): ApiClient {
  const client = createClient<paths>({
    baseUrl,
    // Resolve fetch at call time, so tests can stub it after the client exists.
    fetch: (request) => globalThis.fetch(request),
  });
  client.use({
    onRequest({ request }) {
      const token = getAccessToken();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      return request;
    },
  });
  return client;
}
