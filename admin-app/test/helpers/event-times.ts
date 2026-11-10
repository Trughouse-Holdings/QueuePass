/** Spec 036: fill and read the form's date and time controls as one local value. */
import { expect } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

export type EventTimeLabel = 'Starts' | 'Ends' | 'Doors open';

export function setLocalDateTime(label: EventTimeLabel, value: string): void {
  const [date, time] = value.split('T');
  fireEvent.change(screen.getByLabelText(`${label} date`, { exact: true }), {
    target: { value: date ?? '' },
  });
  fireEvent.change(screen.getByLabelText(`${label} time`, { exact: true }), {
    target: { value: (time ?? '').slice(0, 5) },
  });
}

export function expectLocalDateTime(label: EventTimeLabel, value: string): void {
  const [date, time] = value.split('T');
  expect(screen.getByLabelText(`${label} date`, { exact: true })).toHaveValue(date ?? '');
  expect(screen.getByLabelText(`${label} time`, { exact: true })).toHaveValue(
    (time ?? '').slice(0, 5),
  );
}
