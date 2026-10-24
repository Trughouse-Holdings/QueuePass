import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Attendees } from '../src/pages/Attendees';
import { when } from '../src/format';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, ORDERS } from './fixtures-005';

/** Spec 005 US3 (FR-007): an event's attendee list. */
afterEach(() => vi.unstubAllGlobals());

const PATH = `/events/${EVENT.id}/attendees`;
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/events/:id/attendees" element={<Attendees />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Attendees page', () => {
  it('lists each order with its customer, tier, amount, status, ticket codes, and check-ins', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json(ORDERS) });
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Attendees: Season Opener' }),
    ).toBeInTheDocument();
    const first = screen.getByText('customer3').closest('tr') as HTMLElement;
    expect(within(first).getByText('VIP')).toBeInTheDocument();
    expect(within(first).getByText('$168.60')).toBeInTheDocument();
    expect(within(first).getByText('Confirmed')).toBeInTheDocument();
    expect(within(first).getByText(/ABCDEFGH2345/)).toBeInTheDocument();
    expect(within(first).getByText(/JKLMNPQR6789/)).toBeInTheDocument();
    expect(within(first).getByText('1 of 2 checked in')).toBeInTheDocument();

    const second = screen.getByText('customer1').closest('tr') as HTMLElement;
    expect(within(second).getByText('Refunded')).toBeInTheDocument();
  });

  it('summarizes orders, valid tickets, and check-ins', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json(ORDERS) });
    renderPage();
    expect(
      await screen.findByText('2 orders · 2 valid tickets · 1 checked in'),
    ).toBeInTheDocument();
  });

  it('says when no one has tickets yet', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json([]) });
    renderPage();
    expect(await screen.findByText('No one has tickets for this event yet.')).toBeInTheDocument();
  });

  it('links back to the event', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json([]) });
    renderPage();
    expect(await screen.findByRole('link', { name: 'Back to Season Opener' })).toHaveAttribute(
      'href',
      `/events/${EVENT.id}`,
    );
  });

  it('shows the seat of each seated ticket (spec 007 FR-011)', async () => {
    const seated = [
      {
        ...ORDERS[0],
        tickets: ORDERS[0].tickets.map((t, i) => ({
          ...t,
          seat: i === 0 ? { section: 'A', row: 1, seat: 5 } : null,
        })),
      },
    ];
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json(seated) });
    renderPage();

    const row = (await screen.findByText('customer3')).closest('tr') as HTMLElement;
    const items = within(row)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items[0]).toContain('Section A, Row 1, Seat 5');
    expect(items.slice(1).join(' ')).not.toContain('Section');
  });
});

describe('names and entry times (spec 017 FR-004, FR-005, FR-020)', () => {
  it('shows a Name on tickets column, with "No name on ticket" for an order without one', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json(ORDERS) });
    renderPage();

    expect(
      await screen.findByRole('columnheader', { name: 'Name on tickets' }),
    ).toBeInTheDocument();
    const first = screen.getByText('customer3').closest('tr') as HTMLElement;
    expect(within(first).getByText('Jordan Lee')).toBeInTheDocument();
    const second = screen.getByText('customer1').closest('tr') as HTMLElement;
    expect(within(second).getByText('No name on ticket')).toBeInTheDocument();
  });

  it("shows each checked-in ticket's time of entry", async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json(ORDERS) });
    renderPage();

    const first = (await screen.findByText('customer3')).closest('tr') as HTMLElement;
    const items = within(first)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items[0]).toContain(`checked in ${when('2026-11-01T22:45:00.000Z')}`);
    expect(items[1]).not.toContain('checked in');
  });
});
