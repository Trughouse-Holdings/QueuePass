/**
 * Spec 036 FR-010 (research R2): a date control and a time control side by side, joined into one
 * venue-local value. Shared theme classes only. Each half is kept locally so filling the date and
 * then the time (as tests and typists do) does not lose the first half before both exist.
 */
import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { joinLocalDateTime, splitLocalDateTime } from './event-form-times';

interface DateTimeFieldsProps {
  id: string;
  name: string;
  value: string;
  onChange: (local: string) => void;
  onBlur?: () => void;
  fieldProps?: InputHTMLAttributes<HTMLInputElement>;
}

export function DateTimeFields({
  id,
  name,
  value,
  onChange,
  onBlur,
  fieldProps,
}: DateTimeFieldsProps) {
  const [date, setDate] = useState(() => splitLocalDateTime(value).date);
  const [time, setTime] = useState(() => splitLocalDateTime(value).time);

  useEffect(() => {
    const next = splitLocalDateTime(value);
    setDate(next.date);
    setTime(next.time);
  }, [value]);

  const set = (nextDate: string, nextTime: string) => {
    setDate(nextDate);
    setTime(nextTime);
    onChange(joinLocalDateTime(nextDate, nextTime));
  };

  return (
    <div className="field-row">
      <div className="field">
        <label htmlFor={`${id}-date`}>{`${name} date`}</label>
        <input
          id={`${id}-date`}
          type="date"
          value={date}
          onBlur={onBlur}
          onChange={(e) => set(e.target.value, time)}
          {...fieldProps}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-time`}>{`${name} time`}</label>
        <input
          id={`${id}-time`}
          type="time"
          step={60}
          value={time}
          onBlur={onBlur}
          onChange={(e) => set(date, e.target.value)}
          {...fieldProps}
        />
      </div>
    </div>
  );
}
