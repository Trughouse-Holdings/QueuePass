import { useEffect, useRef, useState } from 'react';

/**
 * Spec 017 FR-008: a labelled code field and Look up. The field keeps focus after each result,
 * so the next code can be typed at once (research R11). `focusSignal` bumps to refocus it
 * (the refusals' "Look up another").
 */
export function TicketLookup({
  busy,
  focusSignal,
  onLookup,
}: {
  busy: boolean;
  focusSignal: number;
  onLookup: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, [focusSignal]);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (busy || code.trim() === '') return;
    onLookup(code);
    setCode('');
    field.current?.focus();
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
      </div>
    </form>
  );
}
