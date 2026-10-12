import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventForm } from '../src/pages/EventForm';

/** FR-034, FR-035, SC-006 — conflict treatment in the admin web app. */

const VENUE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Yum Center',
  address: '1 Arena Plaza, Louisville, KY 40202',
  street: '1 Arena Plaza',
  city: 'Louisville',
  state: 'KY',
  zip: '40202',
  addressVerified: false,
  seatingCapacity: 22090,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

const CONFLICT_BODY = {
  error: {
    code: 'SCHEDULING_CONFLICT',
    message:
      "This venue is already committed from 22:00 to 01:00 UTC by 'Season Opener'. " +
      'Events at the same venue must be at least 60 minutes apart.',
    details: {
      bufferMinutes: 60,
      conflictingEvent: {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Season Opener',
        startsAt: '2026-10-01T22:00:00.000Z',
        endsAt: '2026-10-02T01:00:00.000Z',
      },
    },
  },
};

const VALIDATION_BODY = {
  error: {
    code: 'VALIDATION_FAILED',
    message: 'Request validation failed.',
    details: { fields: ['endsAt must be later than startsAt'] },
  },
};

function mockFetch(postResponse: { status: number; body: unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      // openapi-fetch passes a Request; older call sites passed (url, init).
      const url = typeof input === 'string' ? input : input.url;
      init = { method: typeof input === 'string' ? init?.method : input.method, ...init };
      if (String(url).includes('/locations')) {
        return new Response(JSON.stringify([VENUE]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (init?.method === 'POST') {
        return new Response(JSON.stringify(postResponse.body), {
          status: postResponse.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
}

async function fillAndSubmit(): Promise<void> {
  const user = userEvent.setup();
  await waitFor(() =>
    expect(screen.getByRole('option', { name: /Yum Center/ })).toBeInTheDocument(),
  );

  await user.type(screen.getByLabelText('Event name'), 'Clashing Show');
  await user.selectOptions(screen.getByLabelText('Venue'), VENUE.id);
  await user.type(screen.getByLabelText('Starts'), '2026-10-01T20:00');
  await user.type(screen.getByLabelText('Ends'), '2026-10-01T23:00');
  await user.type(screen.getByLabelText('Total tickets'), '500');
  // Spec 008 US7: priced by a ticket type instead of a base price.
  await user.type(screen.getByLabelText('Ticket type 1 name'), 'General');
  await user.type(screen.getByLabelText('Ticket type 1 price'), '45.00');
  await user.type(screen.getByLabelText('Ticket type 1 quantity'), '500');
  await user.click(screen.getByRole('button', { name: /Schedule event/i }));
}

const renderForm = (): void => {
  render(
    <MemoryRouter initialEntries={['/events/new']}>
      <Routes>
        <Route path="/events/new" element={<EventForm />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('EventForm conflict handling', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('renders a conflict banner naming the conflicting event (FR-034)', async () => {
    mockFetch({ status: 409, body: CONFLICT_BODY });
    renderForm();
    await fillAndSubmit();

    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveAttribute('data-code', 'SCHEDULING_CONFLICT');
    // Assert the banner's OWN conflict treatment, not text that happens to appear in the
    // server message — otherwise this passes even if the conflict branch is removed.
    expect(banner).toHaveClass('banner--conflict');
    expect(banner.querySelector('strong')?.textContent).toBe('Venue already committed');
    expect(await screen.findByTestId('conflict-detail')).toHaveTextContent('Season Opener');
  });

  it('distinguishes a conflict from a validation failure (FR-036)', async () => {
    mockFetch({ status: 400, body: VALIDATION_BODY });
    renderForm();
    await fillAndSubmit();

    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveAttribute('data-code', 'VALIDATION_FAILED');
    expect(banner).toHaveClass('banner--error');
    expect(banner).not.toHaveClass('banner--conflict');
    expect(banner.querySelector('strong')?.textContent).toBe('Could not save');
    expect(screen.queryByTestId('conflict-detail')).toBeNull();
    expect(banner).toHaveTextContent('endsAt must be later than startsAt');
  });

  it('retains every entered value after a rejection (FR-035)', async () => {
    mockFetch({ status: 409, body: CONFLICT_BODY });
    renderForm();
    await fillAndSubmit();
    await screen.findByTestId('error-banner');

    expect(screen.getByLabelText('Event name')).toHaveValue('Clashing Show');
    expect(screen.getByLabelText('Venue')).toHaveValue(VENUE.id);
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-10-01T20:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-10-01T23:00');
    expect(screen.getByLabelText('Total tickets')).toHaveValue(500);
    expect(screen.getByLabelText('Ticket type 1 price')).toHaveValue('45.00');
  });

  it('shows no success state when the save was rejected', async () => {
    mockFetch({ status: 409, body: CONFLICT_BODY });
    renderForm();
    await fillAndSubmit();
    await screen.findByTestId('error-banner');
    expect(screen.queryByTestId('success-state')).toBeNull();
  });
});
