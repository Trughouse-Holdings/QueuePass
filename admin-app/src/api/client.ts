import type { ErrorEnvelope } from '@queuepass/shared';
import { isErrorEnvelope } from '@queuepass/shared';
import { apiBaseUrl, createApiClient, type ApiClient } from '@queuepass/shared/web';

/**
 * The ONLY network path from the admin app to data.
 *
 * Constitution I: this application holds no database connection. Every read and write goes
 * through the REST API, typed by contracts/openapi.yaml (spec 001 research R8), carrying the
 * signed-in admin's own token (FR-012).
 */
let getAccessToken: () => string | undefined = () => undefined;
let onUnauthorized: () => void = () => undefined;

/** Called by <App> with the signed-in user's token source and re-sign-in action. */
export function connectAuth(opts: {
  accessToken: () => string | undefined;
  signIn: () => void;
}): void {
  getAccessToken = opts.accessToken;
  onUnauthorized = opts.signIn;
}

export const api: ApiClient = createApiClient(apiBaseUrl(), () => getAccessToken());

/** A rejected request, carrying the envelope so callers can branch on `code`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly envelope: ErrorEnvelope,
  ) {
    super(envelope.error.message);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.envelope.error.code;
  }

  get details(): Record<string, unknown> | undefined {
    return this.envelope.error.details;
  }
}

/**
 * Unwraps an openapi-fetch result: the data on success, otherwise an ApiError. A 401 means the
 * session is gone, so the user is sent back through sign-in instead of shown an error.
 */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (response.ok) return data as T;

  if (response.status === 401) onUnauthorized();
  if (isErrorEnvelope(error)) throw new ApiError(response.status, error);
  throw new ApiError(response.status, {
    error: { code: 'VALIDATION_FAILED', message: `Request failed with status ${response.status}.` },
  });
}
