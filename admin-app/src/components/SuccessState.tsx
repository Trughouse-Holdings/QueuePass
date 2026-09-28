/** Explicit success state on save (FR-033). */
export function SuccessState({ message }: { message: string }): React.ReactElement {
  return (
    <div role="status" data-testid="success-state" className="banner banner--success">
      <span className="banner__icon" aria-hidden="true">
        ✓
      </span>
      <div className="banner__body">
        <p>{message}</p>
      </div>
    </div>
  );
}
