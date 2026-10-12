import type { ApiError } from '../api/client';

/**
 * Branches on the envelope `code`, never on message text (FR-036).
 *
 * SCHEDULING_CONFLICT gets a visually distinct treatment (amber, not red) because FR-034
 * requires an admin to recognize a double-booking refusal as categorically different from
 * a field validation error — without opening logs or a console (SC-006).
 */
export function ErrorBanner({
  error,
  title,
}: {
  error: ApiError;
  /** Overrides the default "Could not save" heading, e.g. "Could not delete". */
  title?: string;
}): React.ReactElement {
  const isConflict = error.code === 'SCHEDULING_CONFLICT';
  const fields = error.details?.fields as string[] | undefined;
  // Spec 013: ADDRESS_AMBIGUOUS lists the addresses the service matched.
  const candidates = error.details?.candidates as string[] | undefined;

  return (
    <div
      role="alert"
      data-testid="error-banner"
      data-code={error.code}
      className={`banner ${isConflict ? 'banner--conflict' : 'banner--error'}`}
    >
      <span className="banner__icon" aria-hidden="true">
        {isConflict ? '◆' : '✕'}
      </span>
      <div className="banner__body">
        <strong>{isConflict ? 'Venue already committed' : (title ?? 'Could not save')}</strong>
        <p>{error.envelope.error.message}</p>
        {fields && fields.length > 0 && (
          <ul>
            {fields.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        {candidates && candidates.length > 0 && (
          <ul>
            {candidates.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
