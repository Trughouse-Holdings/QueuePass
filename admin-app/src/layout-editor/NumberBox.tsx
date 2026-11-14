import { useEffect, useId, useRef, useState } from 'react';

/** A number as the box shows it: to 0.1, no `-0`. */
export const shown = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return String(r === 0 ? 0 : r);
};

/**
 * Spec 039 FR-011, FR-026: a number typed into the Selection panel. What is typed is kept while
 * the box has focus (so "30" can be typed through "3"); each whole number typed is sent at once;
 * the box shows the value again when it changes elsewhere or focus leaves.
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
        onBlur={() => {
          focused.current = false;
          setText(shown(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = e.target.value.trim() === '' ? NaN : Number(e.target.value);
          if (Number.isFinite(n)) onValue(n);
        }}
      />
    </div>
  );
}
