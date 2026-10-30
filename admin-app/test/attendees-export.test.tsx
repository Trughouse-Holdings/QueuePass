import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Event, Order } from '@queuepass/shared';
import { Attendees } from '../src/pages/Attendees';
import { save } from '../src/export/save';
import { toCsv } from '../src/export/csv';
import { attendeeTable } from '../src/export/attendee-rows';
import { fileName } from '../src/export/file-name';
import { deviceZone } from '../src/export/made';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, ORDERS } from './fixtures-005';

/** Spec 023 US1, US3 (FR-001, FR-003, FR-011): Download on the Attendees page. */
vi.mock('../src/export/save', () => ({ save: vi.fn() }));

const NOTE = "The file contains customers' names and usernames. Keep it private.";
const PATH = `/events/${EVENT.id}/attendees`;
const LOADED_AT = Date.UTC(2026, 9, 30, 18, 5, 0);

beforeEach(() => vi.mocked(save).mockReset());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/events/:id/attendees" element={<Attendees username="admin1" />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Download on the Attendees page', () => {
  it('is offered with the personal-data note when there are orders', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json(ORDERS) });
    renderPage();
    expect(await screen.findByText('Download')).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Download the attendee list', hidden: true }),
    ).toBeInTheDocument();
  });

  it('is not offered when no one has tickets', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json([]) });
    renderPage();
    await screen.findByText('No one has tickets for this event yet.');
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('is not offered while loading or when the list cannot load', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: 'network-error' });
    renderPage();
    expect(screen.getByText('Loading attendees…')).toBeInTheDocument();
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    await screen.findByRole('alert');
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
  });

  it("saves a CSV made from the page's own orders and load time, without a new request", async () => {
    vi.spyOn(Date, 'now').mockReturnValue(LOADED_AT);
    const api = stubApi({
      [`GET /events/${EVENT.id}`]: json(EVENT),
      [`GET ${PATH}`]: json(ORDERS),
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('Download'));
    await user.click(screen.getByRole('button', { name: 'CSV' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [blob, name] = vi.mocked(save).mock.calls[0];
    const table = attendeeTable(
      EVENT as unknown as Event,
      ORDERS as unknown as Order[],
      LOADED_AT,
      'admin1',
    );
    expect(await blob.text()).toBe(await toCsv(table).text());
    expect(name).toBe(fileName('attendees', 'Season Opener', table.madeAt, deviceZone(), 'csv'));
    expect(name).toMatch(/^attendees-season-opener-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/);
    expect(api.count('GET', PATH)).toBe(1);
  });
});
