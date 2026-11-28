import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventDetail } from '../src/pages/EventDetail';
import { EventForm } from '../src/pages/EventForm';
import { when } from '../src/format';
import { json, stubApi } from './helpers/api-stub';
import { fixTimeBeforeFixtures } from './helpers/fixed-time';
import { EVENT, VENUE } from './fixtures-005';
import { layoutRoutes } from './fixtures-038';

/**
 * Spec 041 FR-007, FR-013, FR-019 (T030, T040): an event in a Season says so on its page and its
 * form, naming the Season; the form locks the venue and seating with that reason while the Season
 * is not cancelled; the page says when single tickets go on sale during the presale.
 */
fixTimeBeforeFixtures();
afterEach(() => vi.unstubAllGlobals());

const SEASON = { id: 'c0000000-0000-4000-8000-00000000000c', name: 'Louisville Hoops' };
const IN_SEASON = { ...EVENT, season: SEASON, singleSalesOpenAt: null };
const seasonRead = (status: string) => ({ id: SEASON.id, name: SEASON.name, status });

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetail />} />
        <Route path="/events/:id/edit" element={<EventForm />} />
      </Routes>
    </MemoryRouter>,
  );

const formRoutes = (status: string) => ({
  'GET /locations': json([VENUE]),
  ...layoutRoutes(),
  [`GET /events/${EVENT.id}`]: json(IN_SEASON),
  [`GET /events/${EVENT.id}/tiers`]: json([]),
  [`GET /seasons/${SEASON.id}`]: json(seasonRead(status)),
});

describe('The event form for an event in a Season', () => {
  it('says "In season: …" and locks the venue and seating with that reason', async () => {
    stubApi(formRoutes('ON_SALE'));
    renderAt(`/events/${EVENT.id}/edit`);
    expect(await screen.findByTestId('in-season')).toHaveTextContent('In season: Louisville Hoops');
    const seating = await screen.findByRole('combobox', { name: 'Seating' });
    await waitFor(() => expect(seating).toBeDisabled());
    expect(screen.getByLabelText('Venue')).toBeDisabled();
    expect(
      screen.getAllByText(
        "In season: Louisville Hoops. Its venue, layout and seating can't change.",
      ).length,
    ).toBeGreaterThan(0);
  });

  it('leaves them open when the Season is cancelled, still naming it', async () => {
    stubApi(formRoutes('CANCELLED'));
    renderAt(`/events/${EVENT.id}/edit`);
    expect(await screen.findByTestId('in-season')).toHaveTextContent('Louisville Hoops');
    const seating = await screen.findByRole('combobox', { name: 'Seating' });
    await waitFor(() => expect(screen.getByLabelText('Venue')).toBeEnabled());
    expect(seating).toBeEnabled();
  });
});

describe('The event page for an event in a Season', () => {
  it('names the Season, linked, and says when single tickets go on sale', async () => {
    const at = '2026-09-28T14:00:00.000Z';
    stubApi({ [`GET /events/${EVENT.id}`]: json({ ...IN_SEASON, singleSalesOpenAt: at }) });
    renderAt(`/events/${EVENT.id}`);
    expect(await screen.findByRole('link', { name: 'Louisville Hoops' })).toHaveAttribute(
      'href',
      `/seasons/${SEASON.id}`,
    );
    expect(screen.getByText(`Single tickets on sale from ${when(at)}`)).toBeInTheDocument();
  });

  it('says nothing of a presale when there is none', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(IN_SEASON) });
    renderAt(`/events/${EVENT.id}`);
    await screen.findByRole('link', { name: 'Louisville Hoops' });
    expect(screen.queryByText(/Single tickets on sale from/)).not.toBeInTheDocument();
  });
});
