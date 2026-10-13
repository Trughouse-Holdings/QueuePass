import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServiceUnreachable } from '../../src/web/service-unreachable';

/** Spec 012 FR-010, FR-014 (research R8): the theme's error banner, same text and role. */
it("shows Can't reach the QueuePass service as an error banner, announced as an alert", () => {
  render(<ServiceUnreachable />);
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent("Can't reach the QueuePass service.");
  expect(alert).toHaveClass('banner', 'banner--error');
});
