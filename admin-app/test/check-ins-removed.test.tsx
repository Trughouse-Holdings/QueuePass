import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Attendees } from '../src/pages/Attendees';
import { EventDetail } from '../src/pages/EventDetail';
import { EventForm } from '../src/pages/EventForm';
import { Reports } from '../src/pages/Reports';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, ORDERS, REPORT, VENUE } from './fixtures-005';

/**
 * Spec 032 US2, US3 (FR-009 to FR-011, SC-005; research R7): a removed event's pages show the
 * kept count and say when the details were removed, never a ticket as checked in or not.
 */
afterEach(() => vi.unstubAllGlobals());

const REMOVED_AT = '2026-11-10T03:00:00Z';
const SENTENCE = 'Check-in details removed on Nov 9, 2026 (kept for 7 days after the event).';
const EASTERN = { ...VENUE, timeZone: 'America/New_York', timeZoneSource: 'ADMIN' };
const REMOVED = { ...EVENT, location: EASTERN, checkInDetailsRemovedAt: REMOVED_AT };
const KEPT = { ...EVENT, location: EASTERN, checkInDetailsRemovedAt: null };
// After the removal every ticket's checkedInAt is null.
const EMPTIED = ORDERS.map((o) => ({
  ...o,
  tickets: o.tickets.map((t) => ({ ...t, checkedInAt: null })),
}));
const reportWith = (removedAt: string | null, checkedIn = 3) => ({
  ...REPORT,
  events: REPORT.events.map((e, i) =>
    i === 0
      ? { ...e, timeZone: 'America/New_York', checkedIn, checkInDetailsRemovedAt: removedAt }
      : { ...e, checkInDetailsRemovedAt: null },
  ),
});

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/events/:id/attendees" element={<Attendees />} />
        <Route path="/events/:id/edit" element={<EventForm />} />
        <Route path="/events/:id" element={<EventDetail />} />
        <Route path="/reports" element={<Reports />} />
      </Routes>
    </MemoryRouter>,
  );

const ATTENDEES = `/events/${EVENT.id}/attendees`;
const TIER = {
  id: 't1',
  eventId: EVENT.id,
  name: 'General',
  price: '45.00',
  quantity: 10,
  createdAt: EVENT.createdAt,
  updatedAt: EVENT.updatedAt,
};

describe('Attendees of a removed event (US3-1; FR-010)', () => {
  it('shows the sentence, the kept count in the summary, and no check-in per ticket or order', async () => {
    stubApi({
      [`GET /events/${EVENT.id}`]: json(REMOVED),
      [`GET ${ATTENDEES}`]: json(EMPTIED),
      'GET /reports/sales': json(reportWith(REMOVED_AT)),
    });
    renderAt(ATTENDEES);

    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
    expect(
      await screen.findByText('2 orders · 2 valid tickets · 3 checked in'),
    ).toBeInTheDocument();
    for (const item of screen.getAllByRole('listitem')) {
      expect(item.textContent).not.toContain('checked in');
    }
    const first = screen.getByText('customer3').closest('tr') as HTMLElement;
    expect(within(first).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/of \d+ checked in/)).not.toBeInTheDocument();
  });

  it('leaves the checked-in part out of the summary when the report fails', async () => {
    stubApi({
      [`GET /events/${EVENT.id}`]: json(REMOVED),
      [`GET ${ATTENDEES}`]: json(EMPTIED),
      'GET /reports/sales': 'network-error',
    });
    renderAt(ATTENDEES);

    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
    expect(await screen.findByText('2 orders · 2 valid tickets')).toBeInTheDocument();
  });

  it('is as today for an event not removed, and does not read the report (US3-3)', async () => {
    const api = stubApi({
      [`GET /events/${EVENT.id}`]: json(KEPT),
      [`GET ${ATTENDEES}`]: json(ORDERS),
      'GET /reports/sales': json(reportWith(null)),
    });
    renderAt(ATTENDEES);

    expect(
      await screen.findByText('2 orders · 2 valid tickets · 1 checked in'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Check-in details removed/)).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 checked in')).toBeInTheDocument();
    expect(api.count('GET', '/reports/sales')).toBe(0);
  });
});

describe('the Sales card (US2-2; FR-011)', () => {
  const card = async (event: unknown, report: unknown) => {
    stubApi({
      [`GET /events/${EVENT.id}`]: json(event),
      [`GET /events/${EVENT.id}/tiers`]: json([]),
      'GET /reports/sales': json(report),
    });
    renderAt(`/events/${EVENT.id}`);
    return within(await screen.findByRole('region', { name: 'Sales' }));
  };

  it('shows the kept count and the sentence for a removed event', async () => {
    const sales = await card(REMOVED, reportWith(REMOVED_AT));
    expect(await sales.findByText('3 checked in')).toBeInTheDocument();
    expect(sales.getByText(SENTENCE)).toBeInTheDocument();
  });

  it('has no sentence for an event not removed', async () => {
    const sales = await card(KEPT, reportWith(null, 12));
    expect(await sales.findByText('12 checked in')).toBeInTheDocument();
    expect(sales.queryByText(/Check-in details removed/)).not.toBeInTheDocument();
  });
});

describe('Reports (US2; FR-009, FR-011)', () => {
  it('shows the kept count and "Details removed" in that event\'s row only', async () => {
    stubApi({ 'GET /reports/sales': json(reportWith(REMOVED_AT)) });
    renderAt('/reports');

    const row = (await screen.findByRole('link', { name: 'Season Opener' })).closest(
      'tr',
    ) as HTMLElement;
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText('Details removed Nov 9, 2026')).toBeInTheDocument();
    expect(screen.getAllByText(/Details removed/)).toHaveLength(1);
  });

  it('has no note when nothing was removed (US3-3)', async () => {
    stubApi({ 'GET /reports/sales': json(reportWith(null)) });
    renderAt('/reports');
    await screen.findByRole('link', { name: 'Season Opener' });
    expect(screen.queryByText(/Details removed/)).not.toBeInTheDocument();
  });
});

describe('the edit form (US4; FR-008, Constitution IV)', () => {
  it("shows a 409 CHECK_IN_DETAILS_REMOVED as the form's error banner, values kept", async () => {
    const message =
      'The check-in details of Season Opener were removed on Nov 9, 2026, so its times can no longer change.';
    stubApi({
      'GET /locations': json([EASTERN]),
      [`GET /events/${EVENT.id}`]: json(REMOVED),
      [`GET /events/${EVENT.id}/tiers`]: json([TIER]),
      [`GET /events/${EVENT.id}/seats`]: json({
        eventId: EVENT.id,
        reservedSeating: false,
        sections: [],
      }),
      [`GET /locations/${EASTERN.id}/layout`]: json({
        locationId: EASTERN.id,
        totalSeats: 0,
        sections: [],
      }),
      [`PATCH /events/${EVENT.id}`]: json(
        {
          error: {
            code: 'CHECK_IN_DETAILS_REMOVED',
            message,
            details: { removedAt: REMOVED_AT },
          },
        },
        409,
      ),
    });
    renderAt(`/events/${EVENT.id}/edit`);

    await vi.waitFor(() =>
      expect(screen.getByLabelText('Ticket type 1 name')).toHaveValue('General'),
    );
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-11-01T23:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveAttribute('data-code', 'CHECK_IN_DETAILS_REMOVED');
    expect(banner).toHaveTextContent(message);
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-11-01T23:00');
  });
});
