import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SeasonForm } from '../src/pages/SeasonForm';
import { Seasons } from '../src/pages/Seasons';
import { json, stubApi } from './helpers/api-stub';
import { fixTimeBeforeFixtures } from './helpers/fixed-time';
import {
  CONCERT,
  GAMES,
  LAYOUTS,
  LAYOUT_DETAIL,
  LAYOUT_ID,
  LOWER,
  SEASON_ID,
  SHOW,
  TAKEN,
  UPPER,
  VENUE,
  season,
} from './fixtures-041';

fixTimeBeforeFixtures();
afterEach(() => vi.unstubAllGlobals());

const BASE = {
  'GET /locations': json([VENUE]),
  'GET /events': json([...GAMES, CONCERT, TAKEN, SHOW]),
  [`GET /locations/${VENUE.id}/layouts`]: json(LAYOUTS),
  [`GET /layouts/${LAYOUT_ID}`]: json(LAYOUT_DETAIL),
  [`GET /events/${SHOW.id}/tiers`]: json([
    { id: 't1', eventId: SHOW.id, name: 'General', price: '20.00', quantity: 50, ticketsSold: 0 },
  ]),
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/seasons" element={<Seasons />} />
        <Route path="/seasons/new" element={<SeasonForm />} />
        <Route path="/seasons/:id" element={<SeasonForm />} />
      </Routes>
    </MemoryRouter>,
  );

const eventBoxes = () =>
  within(screen.getByRole('group', { name: 'Events' }))
    .queryAllByRole('checkbox')
    .map((b) => b.closest('label')!.textContent!.split(' · ')[0]);

async function chooseVenueAndLayout(user: ReturnType<typeof userEvent.setup>, layout: string) {
  await user.selectOptions(await screen.findByLabelText('Venue'), VENUE.id);
  const select = screen.getByLabelText('Layout');
  await waitFor(() =>
    expect(within(select).getByRole('option', { name: layout })).toBeInTheDocument(),
  );
  await user.selectOptions(select, within(select).getByRole('option', { name: layout }));
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Season name'), 'Spring Hoops');
  await chooseVenueAndLayout(user, 'Basketball');
  await user.type(screen.getByLabelText('Pass sales end date'), '2026-10-10');
  await user.type(screen.getByLabelText('Pass sales end time'), '18:00');
}

describe('New season (041 US1, T019)', () => {
  it('lists only upcoming scheduled events at the venue on the layout and in no other Season', async () => {
    stubApi(BASE);
    const user = userEvent.setup();
    renderAt('/seasons/new');
    await chooseVenueAndLayout(user, 'Basketball');
    await waitFor(() =>
      expect(eventBoxes()).toEqual([
        'Cardinals vs. Miami',
        'Cardinals vs. Virginia',
        'Cardinals vs. Syracuse',
      ]),
    );
    await user.selectOptions(screen.getByLabelText('Layout'), 'ga');
    await waitFor(() => expect(eventBoxes()).toEqual(['Comedy Night']));
  });

  it('gives each level of the layout a price box, and each ticket type name for general admission', async () => {
    stubApi(BASE);
    const user = userEvent.setup();
    renderAt('/seasons/new');
    await chooseVenueAndLayout(user, 'Basketball');
    expect(await screen.findByLabelText('Lower pass price')).toBeInTheDocument();
    expect(screen.getByLabelText('Upper pass price')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Layout'), 'ga');
    await user.click(await screen.findByRole('checkbox', { name: /Comedy Night/ }));
    expect(await screen.findByLabelText('General pass price')).toBeInTheDocument();
    expect(screen.queryByLabelText('Lower pass price')).not.toBeInTheDocument();
  });

  it('marks each missing field beside it, focuses the first, and sends nothing', async () => {
    const api = stubApi(BASE);
    const user = userEvent.setup();
    renderAt('/seasons/new');
    await screen.findByLabelText('Venue');
    await user.click(screen.getByRole('button', { name: 'Save season' }));
    expect(await screen.findByTestId('name-error')).toHaveTextContent("Enter the season's name.");
    expect(screen.getByTestId('locationId-error')).toBeInTheDocument();
    expect(screen.getByTestId('layoutId-error')).toBeInTheDocument();
    expect(screen.getByTestId('salesEndAt-error')).toHaveTextContent('Enter when pass sales end.');
    expect(screen.getByLabelText('Season name')).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(screen.getByLabelText('Season name')).toHaveFocus());
    expect(api.count('POST', '/seasons')).toBe(0);
  });

  it('refuses a sport with no team beside Team', async () => {
    stubApi(BASE);
    const user = userEvent.setup();
    renderAt('/seasons/new');
    await fillRequired(user);
    await user.selectOptions(screen.getByLabelText('Sport'), 'BASKETBALL');
    await user.click(screen.getByRole('button', { name: 'Save season' }));
    expect(await screen.findByTestId('team-error')).toHaveTextContent('Enter the team');
    await waitFor(() => expect(screen.getByLabelText('Team')).toHaveFocus());
  });

  it('places a Backend refusal beside its field and keeps every value', async () => {
    const api = stubApi({
      ...BASE,
      'POST /seasons': json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed.',
            details: {
              fields: [
                'prices.0 names a price level that is not on this Season’s layout',
                'eventIds.0 Cardinals vs. Miami has already started',
              ],
            },
          },
        },
        400,
      ),
    });
    const user = userEvent.setup();
    renderAt('/seasons/new');
    await fillRequired(user);
    await user.click(await screen.findByRole('checkbox', { name: /Cardinals vs. Miami/ }));
    await user.type(screen.getByLabelText('Upper pass price'), '60');
    await user.click(screen.getByRole('button', { name: 'Save season' }));
    expect(await screen.findByTestId(`price-${UPPER}-error`)).toHaveTextContent(
      'names a price level that is not on this Season’s layout',
    );
    expect(screen.getByTestId('eventIds-error')).toHaveTextContent(
      'Cardinals vs. Miami has already started',
    );
    expect(screen.getByLabelText('Season name')).toHaveValue('Spring Hoops');
    expect(screen.getByLabelText('Upper pass price')).toHaveValue('60');
    expect(screen.getByRole('checkbox', { name: /Cardinals vs. Miami/ })).toBeChecked();
    expect(api.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      name: 'Spring Hoops',
      locationId: VENUE.id,
      layoutId: LAYOUT_ID,
      salesEndAt: '2026-10-10T18:00:00-04:00',
      eventIds: [GAMES[0]!.id],
      prices: [{ levelId: UPPER, price: '60' }],
    });
  });

  it('saves a draft, then puts it on sale', async () => {
    const saved = season();
    const api = stubApi({
      ...BASE,
      'POST /seasons': json(saved, 201),
      [`GET /seasons/${SEASON_ID}`]: json(saved),
      [`POST /seasons/${SEASON_ID}/publish`]: json(
        season({ status: 'ON_SALE', publishedAt: '2026-09-25T12:00:00Z', salesOpen: true }),
      ),
    });
    const user = userEvent.setup();
    renderAt('/seasons/new');
    await fillRequired(user);
    await user.click(await screen.findByRole('checkbox', { name: /Cardinals vs. Miami/ }));
    await user.click(screen.getByRole('checkbox', { name: /Cardinals vs. Virginia/ }));
    await user.type(screen.getByLabelText('Lower pass price'), '100.00');
    await user.type(screen.getByLabelText('Upper pass price'), '60.00');
    await user.click(screen.getByRole('button', { name: 'Save season' }));

    expect(await screen.findByText('Season saved.')).toBeInTheDocument();
    expect(await screen.findByTestId('season-status')).toHaveTextContent('Draft');
    await user.click(screen.getByRole('button', { name: 'Put on sale' }));
    await waitFor(() => expect(screen.getByTestId('season-status')).toHaveTextContent('On sale'));
    expect(api.count('POST', `/seasons/${SEASON_ID}/publish`)).toBe(1);
    expect(screen.getByText('Spring Hoops is on sale.')).toBeInTheDocument();
  });

  it('keeps Put on sale off while the form has unsaved changes (review)', async () => {
    const api = stubApi({ ...BASE, [`GET /seasons/${SEASON_ID}`]: json(season()) });
    const user = userEvent.setup();
    renderAt(`/seasons/${SEASON_ID}`);
    const publish = await screen.findByRole('button', { name: 'Put on sale' });
    expect(publish).toBeEnabled();
    await user.type(screen.getByLabelText('Season name'), ' 2027');
    expect(publish).toBeDisabled();
    expect(screen.getByTestId('publish-hint')).toHaveTextContent('Save your changes first.');
    expect(api.count('POST', `/seasons/${SEASON_ID}/publish`)).toBe(0);
  });

  it('checks a draft before putting it on sale, and sends nothing with fewer than 2 events', async () => {
    const one = season({ events: season().events.slice(0, 1) });
    const api = stubApi({ ...BASE, [`GET /seasons/${SEASON_ID}`]: json(one) });
    const user = userEvent.setup();
    renderAt(`/seasons/${SEASON_ID}`);
    await waitFor(() => expect(screen.getByLabelText('Lower pass price')).toHaveValue('100.00'));
    await user.click(screen.getByRole('button', { name: 'Put on sale' }));
    expect(await screen.findByTestId('eventIds-error')).toHaveTextContent(
      'Choose at least 2 events to put the season on sale.',
    );
    expect(api.count('POST', `/seasons/${SEASON_ID}/publish`)).toBe(0);
  });

  it('asks only for the chosen venue’s events (review)', async () => {
    const api = stubApi(BASE);
    const user = userEvent.setup();
    renderAt('/seasons/new');
    await chooseVenueAndLayout(user, 'Basketball');
    await waitFor(() =>
      expect(
        api.calls.some(
          (c) =>
            c.path === '/events' && new URLSearchParams(c.search).get('locationId') === VENUE.id,
        ),
      ).toBe(true),
    );
  });

  it('places a publish refusal beside the level it names', async () => {
    stubApi({
      ...BASE,
      [`GET /seasons/${SEASON_ID}`]: json(season()),
      [`POST /seasons/${SEASON_ID}/publish`]: json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed.',
            details: { fields: [`prices.${UPPER} Give Upper a price.`] },
          },
        },
        400,
      ),
    });
    const user = userEvent.setup();
    renderAt(`/seasons/${SEASON_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Put on sale' }));
    expect(await screen.findByTestId(`price-${UPPER}-error`)).toHaveTextContent(
      'Give Upper a price.',
    );
    expect(screen.getByTestId('season-status')).toHaveTextContent('Draft');
  });
});

describe('Editing a season (041 US2, T030)', () => {
  const own = (s: ReturnType<typeof season>) =>
    GAMES.map((g) =>
      s.events.some((e) => e.id === g.id) ? { ...g, season: { id: s.id, name: s.name } } : g,
    );

  it('fills the form from the Season, in the venue zone, with its events chosen', async () => {
    const s = season();
    stubApi({ ...BASE, 'GET /events': json(own(s)), [`GET /seasons/${SEASON_ID}`]: json(s) });
    renderAt(`/seasons/${SEASON_ID}`);
    expect(await screen.findByLabelText('Season name')).toHaveValue('Spring Hoops');
    expect(screen.getByLabelText('Pass sales end date')).toHaveValue('2026-10-10');
    expect(screen.getByLabelText('Pass sales end time')).toHaveValue('18:00');
    await waitFor(() => expect(screen.getByLabelText('Lower pass price')).toHaveValue('100.00'));
    expect(screen.getByRole('checkbox', { name: /Cardinals vs. Miami/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Cardinals vs. Syracuse/ })).not.toBeChecked();
  });

  it('locks the events, venue and layout once a pass is sold, saying why; prices stay open', async () => {
    const s = season({ status: 'ON_SALE', passesSold: 1, passRevenue: '160.00' });
    stubApi({ ...BASE, 'GET /events': json(own(s)), [`GET /seasons/${SEASON_ID}`]: json(s) });
    renderAt(`/seasons/${SEASON_ID}`);
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Cardinals vs. Miami/ })).toBeDisabled(),
    );
    expect(await screen.findByRole('checkbox', { name: /Cardinals vs. Syracuse/ })).toBeDisabled();
    // In the Events group, beside the locked boxes, and by the venue and layout (review).
    expect(
      within(screen.getByRole('group', { name: 'Events' })).getByTestId('events-locked'),
    ).toHaveTextContent('Passes have been sold');
    expect(screen.getByTestId('venue-locked')).toHaveTextContent('Passes have been sold');
    expect(screen.getByLabelText('Venue')).toBeDisabled();
    expect(screen.getByLabelText('Layout')).toBeDisabled();
    expect(await screen.findByLabelText('Lower pass price')).toBeEnabled();
    expect(screen.getByTestId('season-status')).toHaveTextContent('On sale');
    expect(screen.getByTestId('season-figures')).toHaveTextContent('1 pass sold · $160.00');
  });

  it('deletes a draft after confirming', async () => {
    const api = stubApi({
      ...BASE,
      [`GET /seasons/${SEASON_ID}`]: json(season()),
      [`DELETE /seasons/${SEASON_ID}`]: json(null, 204),
      'GET /seasons': json([]),
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderAt(`/seasons/${SEASON_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Spring Hoops'));
    expect(await screen.findByText('Deleted "Spring Hoops".')).toBeInTheDocument();
    expect(api.count('DELETE', `/seasons/${SEASON_ID}`)).toBe(1);
  });

  it('offers no Delete for a Season on sale, and nothing is sent when the admin declines', async () => {
    const api = stubApi({
      ...BASE,
      [`GET /seasons/${SEASON_ID}`]: json(season({ status: 'ON_SALE', passesSold: 2 })),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderAt(`/seasons/${SEASON_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Cancel season' }));
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(api.count('POST', `/seasons/${SEASON_ID}/cancel`)).toBe(0);
  });

  it('cancels a Season on sale after a confirmation naming the passes to refund', async () => {
    const onSale = season({ status: 'ON_SALE', passesSold: 1 });
    stubApi({
      ...BASE,
      [`GET /seasons/${SEASON_ID}`]: json(onSale),
      [`POST /seasons/${SEASON_ID}/cancel`]: json({
        season: season({ status: 'CANCELLED', passesSold: 0, cancelledAt: '2026-09-25T12:00:00Z' }),
        passesRefunded: 1,
        ordersRefunded: 2,
        ticketsVoided: 2,
      }),
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderAt(`/seasons/${SEASON_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Cancel season' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 pass will be refunded'));
    expect(await screen.findByText(/1 pass refunded/)).toBeInTheDocument();
    expect(screen.getByTestId('season-status')).toHaveTextContent('Cancelled');
    expect(screen.getByLabelText('Season name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('shows a cancelled Season read-only, saying why', async () => {
    stubApi({
      ...BASE,
      [`GET /seasons/${SEASON_ID}`]: json(
        season({ status: 'CANCELLED', cancelledAt: '2026-09-24T00:00:00Z' }),
      ),
    });
    renderAt(`/seasons/${SEASON_ID}`);
    expect(
      await screen.findByText('This season is cancelled, so it can no longer be changed.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Season name')).toBeDisabled();
    expect(await screen.findByLabelText('Lower pass price')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: /Cancel season|Put on sale|Delete/ }),
    ).not.toBeInTheDocument();
  });

  it('sends a save of a Season on sale with every level priced checked first', async () => {
    const api = stubApi({
      ...BASE,
      [`GET /seasons/${SEASON_ID}`]: json(season({ status: 'ON_SALE' })),
    });
    const user = userEvent.setup();
    renderAt(`/seasons/${SEASON_ID}`);
    const upper = await screen.findByLabelText('Upper pass price');
    await waitFor(() => expect(upper).toHaveValue('60.00'));
    await user.clear(upper);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByTestId(`price-${UPPER}-error`)).toHaveTextContent(
      'Give Upper a price.',
    );
    expect(api.count('PUT', `/seasons/${SEASON_ID}`)).toBe(0);
    expect(LOWER).toBeTruthy();
  });
});
