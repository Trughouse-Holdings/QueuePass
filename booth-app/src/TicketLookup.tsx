import { useEffect, useRef, useState } from 'react';

/**
 * Spec 017 FR-008: a labelled code field and Look up. The field keeps focus after each result,
 * so the next code can be typed at once (research R11). `focusSignal` bumps to refocus it: after
 * an admit's answer, Refuse, and "Look up another". The code is cleared only once a ticket is
 * found: after "No ticket has this code" or a failed request it stays, so nothing has to be
 * retyped (Constitution IV).
 */
export function TicketLookup({
  busy,
  focusSignal,
  onLookup,
  onScan,
}: {
  busy: boolean;
  focusSignal: number;
  /** Resolves `true` when a ticket was found (whatever its state), so the field can clear. */
  onLookup: (code: string) => Promise<boolean>;
  /** Spec 017 FR-009: opens the camera panel (US5). */
  onScan: () => void;
}) {
  const [code, setCode] = useState('');
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, [focusSignal]);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (busy || code.trim() === '') return;
    const sent = code;
    field.current?.focus();
    void onLookup(sent).then((found) => {
      // Only the code that was sent: anything typed meanwhile is the agent's and stays.
      if (found) setCode((now) => (now === sent ? '' : now));
    });
  };

  return (
    <form className="lookup" onSubmit={submit}>
      <label htmlFor="ticket-code">Ticket code</label>
      <div className="lookup__row">
        <input
          id="ticket-code"
          ref={field}
          type="text"
          value={code}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={busy}>
          Look up
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onScan}>
          Scan
        </button>
      </div>
    </form>
  );
}
