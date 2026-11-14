import { useEffect, useId, useRef, useState } from 'react';

/** A number as the box shows it: to 0.1, no `-0`. */
export const shown = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return String(r === 0 ? 0 : r);
};

/**
 * Spec 039 FR-011, FR-026: a number typed into the Selection panel. What is typed is kept while
 * the box has focus, and sent on Enter or when focus leaves (review S2: a number on its way, "1"
 * of "100", is never applied, so it can't push the layout about); the box shows the value again
 * when it changes elsewhere or focus leaves.
 */
export function NumberBox({
  label,
  value,
  onValue,
  step = 1,
  min,
  max,
  disabled,
}: {
  label: string;
  value: number;
  onValue: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
}): React.ReactElement {
  const id = useId();
  const [text, setText] = useState(shown(value));
  const focused = useRef(false);
  const send = (raw: string): void => {
    const n = raw.trim() === '' ? NaN : Number(raw);
    if (Number.isFinite(n) && shown(n) !== shown(value)) onValue(n);
  };
  useEffect(() => {
    if (!focused.current) setText(shown(value));
  }, [value]);
  return (
    <div className="field editor-number">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={text}
        disabled={disabled}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={(e) => {
          focused.current = false;
          send(e.currentTarget.value);
          setText(shown(value));
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          send(e.currentTarget.value);
        }}
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  );
}
