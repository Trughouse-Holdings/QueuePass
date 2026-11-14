import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LayoutDrawing } from '@queuepass/shared';
import { json, stubApi } from '../helpers/api-stub';
import { DRAWING, LAYOUT_ID, detailOf } from './fixtures';
import { DRAWING_PATH, EDIT_PATH, renderEditor, sectionOnMap } from './render-editor';

/**
 * Spec 039 US1 (FR-020; research R15; T027): Save lists the warnings first (overlapping sections,
 * levels with no seats), each overlap outlined on the map, with Save anyway and Go back.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Riverside with 102 moved onto 101 and a level no seat is in. */
const OVERLAPPING: LayoutDrawing = {
  ...DRAWING,
  levels: [...DRAWING.levels, { id: 'lv-up', name: 'Upper', rank: 3, color: 'teal' }],
  sections: [
    DRAWING.sections[0],
    {
      ...DRAWING.sections[1],
      rows: [
        {
          id: 'r-102-1',
          label: '1',
          seats: [
            { id: 'st-102-1', label: '1', at: [21, 30] },
            { id: 'st-102-2', label: '2', at: [23, 30] },
          ],
        },
      ],
    },
  ],
};

describe('warnings before saving', () => {
  it('lists overlaps and empty levels with Save anyway and Go back; Go back saves nothing', async () => {
    const api = stubApi({
      [`GET ${DRAWING_PATH}`]: json(OVERLAPPING),
      [`PUT ${DRAWING_PATH}`]: json(detailOf(LAYOUT_ID)),
    });
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    const warnings = screen.getByRole('group', { name: 'Before saving' });
    expect(within(warnings).getByText('Section 102 overlaps 101')).toBeInTheDocument();
    expect(within(warnings).getByText('Upper has no seats')).toBeInTheDocument();
    expect(sectionOnMap('101').getAttribute('class')).toContain('editor-map__section--warn');
    expect(sectionOnMap('102').getAttribute('class')).toContain('editor-map__section--warn');
    await user.click(within(warnings).getByRole('button', { name: 'Go back' }));
    expect(screen.queryByRole('group', { name: 'Before saving' })).toBeNull();
    expect(api.count('PUT', DRAWING_PATH)).toBe(0);
  });

  it('Save anyway saves', async () => {
    const api = stubApi({
      [`GET ${DRAWING_PATH}`]: json(OVERLAPPING),
      [`PUT ${DRAWING_PATH}`]: json(detailOf(LAYOUT_ID)),
    });
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(api.count('PUT', DRAWING_PATH)).toBe(1));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('with no warnings, Save saves at once', async () => {
    const api = stubApi({
      [`GET ${DRAWING_PATH}`]: json(DRAWING),
      [`PUT ${DRAWING_PATH}`]: json(detailOf(LAYOUT_ID)),
    });
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.count('PUT', DRAWING_PATH)).toBe(1));
    expect(screen.queryByRole('group', { name: 'Before saving' })).toBeNull();
  });
});
