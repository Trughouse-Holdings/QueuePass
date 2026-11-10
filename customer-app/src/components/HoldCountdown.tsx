/** Spec 015 FR-005: seconds as `m:ss`. */
export const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Spec 033 FR-010, FR-015 (research R9): a reservation's countdown in large type, as a timer that
 * is not announced each second (aria-live off), with its own status region for the 1-minute
 * warning (`015` FR-012), always present so the warning is announced, and boxed only while it has
 * something to say. Shared by the event page's Your seats box and each cart entry.
 */
export function HoldCountdown({
  secondsLeft,
  warning,
}: {
  secondsLeft: number;
  warning: string | null;
}) {
  return (
    <>
      <p role="timer" aria-live="off" className="hold-countdown">
        Time left: <span className="hold-countdown__time">{clock(secondsLeft)}</span>
      </p>
      <p role="status" className={warning ? 'note' : undefined}>
        {warning}
      </p>
    </>
  );
}

/** Spec 033 FR-015: the 1-minute warning's words. */
export const ONE_MINUTE_LEFT = '1 minute left to buy your seats.';
