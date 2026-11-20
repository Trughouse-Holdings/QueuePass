import { fireEvent, screen } from '@testing-library/react';
import { json } from './api-stub';

/**
 * 2026-11-19: a new venue starts from a layout file. A small format-1 file whose one row holds
 * `seats` seats, as the New venue form reads it (the Backend checks the rest).
 */
export const layoutFile = (seats = 22090, name = 'basketball.json'): File =>
  new File(
    [
      JSON.stringify({
        format: 1,
        name: 'Basketball',
        levels: [{ key: 'all', name: 'All', rank: 1, color: 'violet' }],
        sections: [
          {
            name: '101',
            level: 'all',
            rows: [{ label: 'A', seats: { first: 1, count: seats, from: [0, 0], to: [1, 0] } }],
          },
        ],
      }),
    ],
    name,
    { type: 'application/json' },
  );

/** Chooses a layout file in the New venue form's Layout file box. */
export const chooseLayoutFile = (file: File = layoutFile()): void => {
  fireEvent.change(screen.getByLabelText('Layout file'), { target: { files: [file] } });
};

/** The import after the venue is created, for any venue id. */
export const IMPORT_ROUTE = {
  'POST /locations/*/layouts/import': json({ id: 'l-imported' }, 201),
};
