import { useEffect, useId, useRef, useState } from 'react';

/**
 * Spec 039 FR-010, FR-012 (edge case "Names and labels"): a name or label typed in place and
 * kept on Enter or on leaving the box, if `check` finds nothing wrong; otherwise its problem is
 * shown beside the box and nothing changes. The box follows the value when it changes elsewhere.
 */
export function CommitBox({
  label,
  value,
  maxLength,
  check,
  onCommit,
}: {
  label: string;
  value: string;
  maxLength: number;
  check: (text: string) => string | null;
  onCommit: (text: string) => void;
}): React.ReactElement {
  const id = useId();
  const problemId = useId();
  const [text, setText] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
    setProblem(null);
  }, [value]);
  const keep = (): void => {
    if (text.trim() === value) {
      setProblem(null);
      return;
    }
    const p = check(text);
    setProblem(p);
    if (!p) onCommit(text);
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={text}
        maxLength={maxLength}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          keep();
        }}
        onBlur={() => {
          focused.current = false;
          keep();
        }}
      />
      {problem && (
        <span id={problemId} className="editor-field-error">
          {problem}
        </span>
      )}
    </div>
  );
}
