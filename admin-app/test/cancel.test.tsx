import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventDetail } from '../src/pages/EventDetail';
import { EventList } from '../src/pages/EventList';
import { json, stubApi } from './helpers/api-stub';
import { CANCELLED_EVENT, EVENT, REPORT } from './fixtures-005';

/** Spec 005 US4 (FR-008, FR-009): cancelling an event from its page. */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PATH = `/events/${EVENT.id}`;
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/events" element={<EventList />} />
        <Route path="/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Cancel event', () => {
  it('sends nothing when the admin dismisses the confirmation', async () => {
    const { calls } = stubApi({ [`GET ${PATH}`]: json(EVENT), [`GET ${PATH}/tiers`]: json([]) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderAt(PATH);

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel event' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Season Opener'));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('cancels after confirmation, reports the counts, and makes the page read-only', async () => {
    let current: typeof EVENT | typeof CANCELLED_EVENT = EVENT;
    const { calls } = stubApi({
      [`GET ${PATH}`]: () => json(current),
      [`GET ${PATH}/tiers`]: json([]),
      [`POST ${PATH}/cancel`]: () => {
        current = CANCELLED_EVENT;
        return json({ event: CANCELLED_EVENT, ordersRefunded: 3, ticketsVoided: 7 });
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAt(PATH);

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel event' }));

    expect(
      await screen.findByText('Cancelled. 3 orders refunded, 7 tickets voided.'),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST' && c.path === `${PATH}/cancel`)).toHaveLength(1);
    expect(screen.getByText('Cancelled', { selector: '.pill' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel event' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add tier' })).toBeNull();
  });

  it('refreshes the Sales card after cancelling, so refunded sales disappear', async () => {
    let current: typeof EVENT | typeof CANCELLED_EVENT = EVENT;
    const sold = REPORT;
    const refunded = {
      ...REPORT,
      events: [
        { ...REPORT.events[0], status: 'CANCELLED', ticketsSold: 0, checkedIn: 0, revenue: '0.00' },
      ],
    };
    stubApi({
      [`GET ${PATH}`]: () => json(current),
      [`GET ${PATH}/tiers`]: json([]),
      'GET /reports/sales': () => json(current === EVENT ? sold : refunded),
      [`POST ${PATH}/cancel`]: () => {
        current = CANCELLED_EVENT;
        return json({ event: CANCELLED_EVENT, ordersRefunded: 3, ticketsVoided: 7 });
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAt(PATH);

    expect(await screen.findByText('25 of 100 tickets sold')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel event' }));
    expect(await screen.findByText('0 of 100 tickets sold')).toBeInTheDocument();
  });

  it('shows a refusal in the banner', async () => {
    stubApi({
      [`GET ${PATH}`]: json(EVENT),
      [`GET ${PATH}/tiers`]: json([]),
      [`POST ${PATH}/cancel`]: json(
        {
          error: {
            code: 'EVENT_CANCELLED',
            message: 'Season Opener is cancelled and can no longer be changed or sold.',
          },
        },
        409,
      ),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAt(PATH);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('can no longer be changed');
  });

  it('marks a cancelled event on the event list and the event page', async () => {
    stubApi({ 'GET /events': json([CANCELLED_EVENT]), 'GET /locations': json([]) });
    renderAt('/events');
    expect(await screen.findByText('Cancelled', { selector: '.pill' })).toBeInTheDocument();
  });

  it('links to the attendee list', async () => {
    stubApi({ [`GET ${PATH}`]: json(EVENT), [`GET ${PATH}/tiers`]: json([]) });
    renderAt(PATH);
    expect(await screen.findByRole('link', { name: 'Attendees' })).toHaveAttribute(
      'href',
      `${PATH}/attendees`,
    );
  });
});
