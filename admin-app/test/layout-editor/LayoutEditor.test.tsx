import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setMediaQuery } from '../../../packages/shared/test/web/browser-stubs';
import { json, stubApi } from '../helpers/api-stub';
import { DRAWING, LAYOUT_ID, LOCKED, VENUE_ID, detailOf } from './fixtures';
import {
  CREATE_PATH,
  DRAWING_PATH,
  EDIT_PATH,
  NEW_PATH,
  map,
  panel,
  renderEditor,
  sectionOnMap,
} from './render-editor';

/**
 * Spec 039 US1, US3 (T022; research R13, R14, R16): the editor page. A new layout starts empty
 * with one level; an existing one is read whole and drawn; Save creates or saves the whole layout;
 * a refusal by path selects the section at fault and keeps the document; a locked layout and a
 * phone-width screen are read-only; every change is announced in a polite status line.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setMediaQuery('(max-width: 640px)', false);
});

/** Generates a small section through the Add section form. */
async function addSection(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(panel('Sections')).getByRole('button', { name: 'Add section' }));
  const form = screen.getByRole('form', { name: 'Add section' });
  await user.type(within(form).getByLabelText('Section name'), name);
  await user.clear(within(form).getByLabelText('Rows'));
  await user.type(within(form).getByLabelText('Rows'), '2');
  await user.clear(within(form).getByLabelText('Seats per row'));
  await user.type(within(form).getByLabelText('Seats per row'), '3');
  await user.click(within(form).getByRole('button', { name: 'Generate' }));
}

describe('a new layout', () => {
  it('opens with an empty map, a name box, one level "Standard" and floor None', async () => {
    stubApi({});
    renderEditor(NEW_PATH);
    expect(await screen.findByRole('heading', { name: 'New layout' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Layout name' })).toHaveValue('');
    expect(within(map()).queryAllByRole('button', { name: /^Section / })).toHaveLength(0);
    expect(within(panel('Price levels')).getByText('Standard')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Floor object' })).toHaveValue('NONE');
  });

  it('refuses to save without a name or a section, naming what is missing', async () => {
    const api = stubApi({});
    const user = userEvent.setup();
    renderEditor(NEW_PATH);
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Name the layout');
    expect(alert).toHaveTextContent('Add at least one section');
    expect(api.calls).toHaveLength(0);
  });

  it('Save calls createLayoutDrawing and moves to the new layout’s edit route', async () => {
    const api = stubApi({
      [`POST ${CREATE_PATH}`]: json(detailOf('lay-new', 'Basketball'), 201),
      'GET /layouts/lay-new/drawing': json({
        ...DRAWING,
        id: 'lay-new',
        name: 'Basketball',
        revision: 1,
      }),
    });
    const user = userEvent.setup();
    const { router } = renderEditor(NEW_PATH);
    await user.type(await screen.findByRole('textbox', { name: 'Layout name' }), 'Basketball');
    await addSection(user, '101');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/locations/${VENUE_ID}/layouts/lay-new/edit`),
    );
    const body = api.calls.find((c) => c.method === 'POST')?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('revision');
    expect(body).toMatchObject({ name: 'Basketball', floor: { kind: 'NONE' } });
    expect((body.sections as unknown[]).length).toBe(1);
    expect(await screen.findByRole('textbox', { name: 'Layout name' })).toHaveValue('Basketball');
  });
});

describe('an existing layout', () => {
  it('loads the drawing and draws each section with its name, and the floor', async () => {
    stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
    const { container } = renderEditor(EDIT_PATH);
    expect(await screen.findByRole('textbox', { name: 'Layout name' })).toHaveValue('Riverside');
    expect(sectionOnMap('101')).toHaveAccessibleName('Section 101, Standard, 6 seats');
    expect(sectionOnMap('102')).toBeInTheDocument();
    expect(container.querySelectorAll('.editor-map__section path')).toHaveLength(2);
    expect(within(map()).getByText('101')).toBeInTheDocument();
    expect(container.querySelector('.editor-map__floor')).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Floor object' })).toHaveValue('COURT');
  });

  it('Save sends the whole layout with its revision, reads it back and shows Saved', async () => {
    const api = stubApi({
      [`GET ${DRAWING_PATH}`]: () => json(DRAWING),
      [`PUT ${DRAWING_PATH}`]: json(detailOf(LAYOUT_ID)),
    });
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    const name = await screen.findByRole('textbox', { name: 'Layout name' });
    await user.clear(name);
    await user.type(name, 'Riverside bowl');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    const put = api.calls.find((c) => c.method === 'PUT');
    expect(put?.body).toMatchObject({ revision: 4, name: 'Riverside bowl' });
    expect(api.count('GET', DRAWING_PATH)).toBe(2);
  });

  it('a LAYOUT_FILE_INVALID refusal selects the section at its path and keeps the document', async () => {
    const message = 'Section 102, row 1: seat label "1" is used twice';
    const api = stubApi({
      [`GET ${DRAWING_PATH}`]: json(DRAWING),
      [`PUT ${DRAWING_PATH}`]: json(
        {
          error: {
            code: 'LAYOUT_FILE_INVALID',
            message: 'The layout has 1 problem.',
            details: { problems: [{ path: 'sections[1].rows[0].seats[1].label', message }] },
          },
        },
        400,
      ),
    });
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    const name = await screen.findByRole('textbox', { name: 'Layout name' });
    await user.type(name, '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(sectionOnMap('102')).toHaveAttribute('aria-pressed', 'true');
    expect(sectionOnMap('101')).toHaveAttribute('aria-pressed', 'false');
    expect(name).toHaveValue('Riverside!');
    // The same document goes again.
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.count('PUT', DRAWING_PATH)).toBe(2));
    const [first, second] = api.calls.filter((c) => c.method === 'PUT');
    expect(second.body).toEqual(first.body);
  });

  it('a name refusal is shown beside the name box', async () => {
    stubApi({
      [`GET ${DRAWING_PATH}`]: json(DRAWING),
      [`PUT ${DRAWING_PATH}`]: json(
        { error: { code: 'LAYOUT_NAME_TAKEN', message: 'Another layout is named Riverside.' } },
        409,
      ),
    });
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    const name = await screen.findByRole('textbox', { name: 'Layout name' });
    await user.type(name, ' 2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(name).toHaveAccessibleDescription('Another layout is named Riverside.'),
    );
  });

  it('a layout that cannot be read says so', async () => {
    stubApi({
      [`GET ${DRAWING_PATH}`]: json(
        { error: { code: 'NOT_FOUND', message: 'No such layout.' } },
        404,
      ),
    });
    renderEditor(EDIT_PATH);
    expect(await screen.findByRole('alert')).toHaveTextContent('No such layout.');
  });
});

describe('read-only', () => {
  it('a locked layout says why and has no editing controls', async () => {
    stubApi({ [`GET ${DRAWING_PATH}`]: json(LOCKED) });
    renderEditor(EDIT_PATH);
    expect(
      await screen.findByText(
        'Locked: seats are sold or held at Cardinals vs. Duke and Spring concert',
      ),
    ).toBeInTheDocument();
    expect(sectionOnMap('101')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Layout name' })).toBeNull();
  });

  it('at phone width it shows the preview and says editing needs a wider screen', async () => {
    setMediaQuery('(max-width: 640px)', true);
    stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
    renderEditor(EDIT_PATH);
    expect(await screen.findByRole('img', { name: 'Riverside: 2 sections' })).toBeInTheDocument();
    expect(screen.getByText('Editing a layout needs a wider screen.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('application')).toBeNull();
  });
});

describe('the status line', () => {
  it('is a polite live region announcing each change', async () => {
    stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Floor object' }), 'RING');
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Floor object set to Ring');
  });
});

describe('unsaved changes (T028, R13)', () => {
  it('following a link asks to confirm; Cancel stays with the change kept, OK leaves', async () => {
    stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    const { router } = renderEditor(EDIT_PATH);
    const name = await screen.findByRole('textbox', { name: 'Layout name' });
    await user.type(name, ' bowl');
    await user.click(screen.getByRole('link', { name: 'Back to the venue' }));
    expect(confirm).toHaveBeenCalledWith('Leave without saving? Your changes will be lost.');
    expect(router.state.location.pathname).toBe(EDIT_PATH);
    expect(screen.getByRole('textbox', { name: 'Layout name' })).toHaveValue('Riverside bowl');
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('link', { name: 'Back to the venue' }));
    expect(await screen.findByText('Venue page')).toBeInTheDocument();
  });

  it('leaves without asking when nothing changed', async () => {
    stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
    const confirm = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    await user.click(await screen.findByRole('link', { name: 'Back to the venue' }));
    expect(await screen.findByText('Venue page')).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('holds a reload or a closed tab with beforeunload while dirty, not once saved', async () => {
    stubApi({
      [`GET ${DRAWING_PATH}`]: json(DRAWING),
      [`PUT ${DRAWING_PATH}`]: json(detailOf(LAYOUT_ID)),
    });
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    const unload = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    await user.type(await screen.findByRole('textbox', { name: 'Layout name' }), '!');
    expect(unload()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved');
    expect(unload()).toBe(false);
  });
});

describe('Duplicate to edit (T047, FR-002)', () => {
  it("a locked layout's Duplicate to edit makes a copy and opens its edit route", async () => {
    const api = stubApi({
      [`GET ${DRAWING_PATH}`]: json(LOCKED),
      [`POST /layouts/${LAYOUT_ID}/duplicate`]: json(detailOf('lay-copy', 'Riverside (copy)'), 201),
      'GET /layouts/lay-copy/drawing': json({
        ...DRAWING,
        id: 'lay-copy',
        name: 'Riverside (copy)',
        revision: 1,
      }),
    });
    const user = userEvent.setup();
    const { router } = renderEditor(EDIT_PATH);
    await user.click(await screen.findByRole('button', { name: 'Duplicate to edit' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/locations/${VENUE_ID}/layouts/lay-copy/edit`),
    );
    expect(api.count('POST', `/layouts/${LAYOUT_ID}/duplicate`)).toBe(1);
    expect(await screen.findByRole('textbox', { name: 'Layout name' })).toHaveValue(
      'Riverside (copy)',
    );
  });

  it('shows a refused duplicate beside the button', async () => {
    stubApi({
      [`GET ${DRAWING_PATH}`]: json(LOCKED),
      [`POST /layouts/${LAYOUT_ID}/duplicate`]: json(
        { error: { code: 'LAYOUT_NAME_TAKEN', message: 'Riverside (copy) is taken.' } },
        409,
      ),
    });
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    await user.click(await screen.findByRole('button', { name: 'Duplicate to edit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Riverside (copy) is taken.');
  });
});
