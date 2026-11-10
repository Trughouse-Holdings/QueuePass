import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventForm } from '../src/pages/EventForm';
import { defaultEventInstants } from '../src/pages/event-form-times';
import { json, stubApi } from './helpers/api-stub';
import { expectLocalDateTime, setLocalDateTime } from './helpers/event-times';
import { EVENT, VENUE } from './fixtures-005';

/**
 * Spec 036 FR-017 (#160): a new event opens on the next whole hour, today, and ends 4 hours later;
 * Ends follows the start until it is changed; untouched defaults follow the venue's zone. Only
 * Date is faked, so the form's own timers and the stubbed requests still run.
 */
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const CENTRAL = {
  ...VENUE,
  id: 'v-central',
  name: 'Prairie Hall',
  timeZone: 'America/Chicago',
  timeZoneSource: 'ADMIN',
};

function at(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

function newForm() {
  const api = stubApi({
    'GET /locations': json([CENTRAL]),
    [`GET /locations/${CENTRAL.id}/layout`]: json({
      locationId: CENTRAL.id,
      totalSeats: 0,
      sections: [],
    }),
    'POST /events': json({ ...EVENT, locationId: CENTRAL.id }, 201),
  });
  render(
    <MemoryRouter initialEntries={['/events/new']}>
      <Routes>
        <Route path="/events/new" element={<EventForm />} />
        <Route path="/events/:id" element={<p>Event page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return api;
}

const pickVenue = async () => {
  await screen.findByRole('option', { name: /Prairie Hall/ });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: CENTRAL.id } });
};

describe('defaultEventInstants (FR-017)', () => {
  it.each([
    ['2026-11-10T17:41:00Z', '2026-11-10T18:00:00.000Z', '2026-11-10T22:00:00.000Z'],
    ['2026-11-10T18:00:00Z', '2026-11-10T19:00:00.000Z', '2026-11-10T23:00:00.000Z'],
    ['2026-11-11T04:30:00Z', '2026-11-11T05:00:00.000Z', '2026-11-11T09:00:00.000Z'],
  ])('at %s: starts %s, ends %s', (now, start, end) => {
    const d = defaultEventInstants(now);
    expect(d.startsAt.toISOString()).toBe(start);
    expect(d.endsAt.toISOString()).toBe(end);
  });
});

describe('a new event opens with times (FR-017)', () => {
  it('at 12:41 PM Eastern: Starts today at 1:00 PM, Ends 5:00 PM, doors 1 hour before', async () => {
    at('2026-11-10T17:41:00Z');
    newForm();
    expectLocalDateTime('Starts', '2026-11-10T13:00');
    expectLocalDateTime('Ends', '2026-11-10T17:00');
  });

  it("choosing a venue in another zone recomputes untouched defaults in that zone's time", async () => {
    at('2026-11-10T17:41:00Z');
    const api = newForm();
    await pickVenue();
    // 18:00Z is 12:00 PM CST.
    expectLocalDateTime('Starts', '2026-11-10T12:00');
    expectLocalDateTime('Ends', '2026-11-10T16:00');
    expect(screen.getByTestId('doorsOpenAt-preview')).toHaveTextContent(
      'Doors open at 11:00 AM CST',
    );
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Fall Concert' } });
    await screen.findByLabelText('Ticket type 1 name');
    fireEvent.change(screen.getByLabelText('Ticket type 1 name'), { target: { value: 'General' } });
    fireEvent.change(screen.getByLabelText('Ticket type 1 price'), { target: { value: '45.00' } });
    fireEvent.change(screen.getByLabelText('Ticket type 1 quantity'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(api.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      startsAt: '2026-11-10T12:00:00-06:00',
      endsAt: '2026-11-10T16:00:00-06:00',
      doorsOpenAt: '2026-11-10T11:00:00-06:00',
    });
  });

  it('late at night the next whole hour is tomorrow', async () => {
    at('2026-11-11T04:30:00Z'); // 11:30 PM EST on Nov 10
    newForm();
    expectLocalDateTime('Starts', '2026-11-11T00:00');
    expectLocalDateTime('Ends', '2026-11-11T04:00');
  });

  it('on a fall-back night a repeated default is already chosen, and 4 hours is elapsed time', async () => {
    at('2027-11-07T05:30:00Z'); // 12:30 AM CDT in Chicago
    newForm();
    await pickVenue();
    // 06:00Z is the first 1:00 AM (CDT); 4 elapsed hours later is 4:00 AM CST.
    expectLocalDateTime('Starts', '2027-11-07T01:00');
    expect(
      within(screen.getByTestId('startsAt-occurrence')).getByLabelText(
        '1:00 AM CDT (the first time)',
      ),
    ).toBeChecked();
    expectLocalDateTime('Ends', '2027-11-07T04:00');
  });
});

describe('Ends follows the start until it is changed (FR-017)', () => {
  it('keeps 4 hours after a new start, then stays where the admin put it', async () => {
    at('2026-11-10T17:41:00Z');
    newForm();
    await pickVenue();
    setLocalDateTime('Starts', '2026-11-20T19:00');
    expectLocalDateTime('Ends', '2026-11-20T23:00');
    setLocalDateTime('Ends', '2026-11-20T22:00');
    setLocalDateTime('Starts', '2026-11-20T20:00');
    expectLocalDateTime('Ends', '2026-11-20T22:00');
  });

  it('a changed start is kept when the venue changes', async () => {
    at('2026-11-10T17:41:00Z');
    newForm();
    setLocalDateTime('Starts', '2026-11-20T19:00');
    await pickVenue();
    expectLocalDateTime('Starts', '2026-11-20T19:00');
    expectLocalDateTime('Ends', '2026-11-20T23:00');
  });
});
