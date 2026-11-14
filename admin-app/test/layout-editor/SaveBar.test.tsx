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

describe('refused as changed or locked (T047, FR-023, FR-024)', () => {
  const changed = json(
    {
      error: {
        code: 'LAYOUT_CHANGED',
        message: 'Riverside was changed since you opened it.',
        details: { revision: 5 },
      },
    },
    409,
  );
  const locked = json(
    {
      error: {
        code: 'LAYOUT_IN_USE',
        message: 'Riverside is used by "Cardinals vs. Duke", which has sold or held seats.',
        details: { events: [{ id: 'e1', name: 'Cardinals vs. Duke' }] },
      },
    },
    409,
  );

  async function refusedWith(reply: Response, extra = {}) {
    const api = stubApi({
      [`GET ${DRAWING_PATH}`]: json(DRAWING),
      [`PUT ${DRAWING_PATH}`]: reply,
      [`POST /locations/v1/layouts/drawing`]: json(detailOf('lay-new', 'Riverside (copy)'), 201),
      'GET /layouts/lay-new/drawing': json({ ...DRAWING, id: 'lay-new', name: 'Riverside (copy)' }),
      ...extra,
    });
    const user = userEvent.setup();
    const view = renderEditor(EDIT_PATH);
    const name = await screen.findByRole('textbox', { name: 'Layout name' });
    await user.type(name, '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    return { api, user, ...view };
  }

  it('LAYOUT_CHANGED keeps the document and offers Save as a new layout, which opens the copy', async () => {
    const { api, user, router } = await refusedWith(changed);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Riverside was changed since you opened it.',
    );
    expect(screen.getByRole('textbox', { name: 'Layout name' })).toHaveValue('Riverside!');
    await user.click(screen.getByRole('button', { name: 'Save as a new layout' }));
    const box = screen.getByRole('textbox', { name: 'Name of the new layout' });
    expect(box).toHaveValue('Riverside! (copy)');
    await user.clear(box);
    await user.type(box, 'Riverside (copy)');
    await user.click(screen.getByRole('button', { name: 'Save new layout' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/locations/v1/layouts/lay-new/edit'),
    );
    const post = api.calls.find((c) => c.method === 'POST');
    expect(post?.body).toMatchObject({ name: 'Riverside (copy)' });
    expect(post?.body).not.toHaveProperty('revision');
    expect((post?.body as { sections: object[] }).sections[0]).not.toHaveProperty('id');
  });

  it('LAYOUT_CHANGED offers Reload, which reads the layout again after a confirm', async () => {
    const { api, user } = await refusedWith(changed);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(confirm).toHaveBeenCalledWith('Reload the layout? Your changes will be lost.');
    expect(screen.getByRole('textbox', { name: 'Layout name' })).toHaveValue('Riverside!');
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Layout name' })).toHaveValue('Riverside'),
    );
    expect(api.count('GET', DRAWING_PATH)).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('LAYOUT_IN_USE (locked) shows the message as sent and offers Save as a new layout, not Reload', async () => {
    await refusedWith(locked);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Riverside is used by "Cardinals vs. Duke", which has sold or held seats.',
    );
    expect(screen.getByRole('button', { name: 'Save as a new layout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });

  it('a refused new layout is shown beside its name box', async () => {
    const { user } = await refusedWith(changed, {
      [`POST /locations/v1/layouts/drawing`]: json(
        {
          error: {
            code: 'LAYOUT_NAME_TAKEN',
            message: 'Another layout is named Riverside! (copy).',
          },
        },
        409,
      ),
    });
    await user.click(screen.getByRole('button', { name: 'Save as a new layout' }));
    await user.click(screen.getByRole('button', { name: 'Save new layout' }));
    expect(
      await screen.findByText('Another layout is named Riverside! (copy).'),
    ).toBeInTheDocument();
  });
});
