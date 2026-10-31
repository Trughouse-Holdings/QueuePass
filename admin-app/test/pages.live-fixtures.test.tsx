import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LocationList } from '../src/pages/LocationList';
import { EventList } from '../src/pages/EventList';
import { LocationForm } from '../src/pages/LocationForm';
import { EventForm } from '../src/pages/EventForm';

import locations from './fixtures/locations.json';
import events from './fixtures/events.json';
import conflict409 from './fixtures/conflict-409.json';
import validation400 from './fixtures/validation-400.json';
import capacity409 from './fixtures/capacity-409.json';

/**
 * UI verification against payloads CAPTURED FROM THE LIVE BACKEND, not hand-written
 * fixtures. If the API's real shape drifts from what these components expect, these
 * fail — which a fixture I invented could never catch.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function route(handlers: {
  locations?: Response | (() => Response);
  events?: Response | (() => Response);
  post?: { status: number; body: unknown };
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      // openapi-fetch passes a Request; older call sites passed (url, init).
      const url = typeof input === 'string' ? input : input.url;
      init = { method: typeof input === 'string' ? init?.method : input.method, ...init };
      const u = String(url);
      if (init?.method === 'POST' && handlers.post) {
        return json(handlers.post.body, handlers.post.status);
      }
      if (u.includes('/locations')) {
        const h = handlers.locations ?? json(locations);
        return typeof h === 'function' ? h() : h.clone();
      }
      if (u.includes('/events')) {
        const h = handlers.events ?? json(events);
        return typeof h === 'function' ? h() : h.clone();
      }
      return json(null);
    }),
  );
}

const renderAt = (path: string, pattern: string, el: React.ReactElement): void => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={el} />
      </Routes>
    </MemoryRouter>,
  );
};

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.clearAllMocks());

describe('LocationList against live data', () => {
  it('renders every venue the API actually returned', async () => {
    route({ locations: () => json(locations) });
    renderAt('/locations', '/locations', <LocationList />);

    for (const l of locations) {
      expect(await screen.findByText(l.name)).toBeInTheDocument();
      expect(screen.getByText(l.address)).toBeInTheDocument();
    }
    // Capacity is rendered with thousands separators
    expect(screen.getByText('22,090')).toBeInTheDocument();
    expect(screen.getByText('19,000')).toBeInTheDocument();
  });

  it('exposes an Edit link but no delete control: delete lives on the venue page (spec 002 R3)', async () => {
    route({ locations: () => json(locations) });
    renderAt('/locations', '/locations', <LocationList />);

    expect(await screen.findAllByText('Edit')).toHaveLength(locations.length);
    expect(screen.queryByText(/delete/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('links each venue name to its detail page', async () => {
    route({ locations: () => json(locations) });
    renderAt('/locations', '/locations', <LocationList />);
    for (const l of locations) {
      expect(await screen.findByRole('link', { name: l.name })).toHaveAttribute(
        'href',
        `/locations/${l.id}`,
      );
    }
  });

  it('shows an empty state when there are no venues', async () => {
    route({ locations: () => json([]) });
    renderAt('/locations', '/locations', <LocationList />);
    expect(await screen.findByText(/No venues yet/i)).toBeInTheDocument();
  });
});

describe('EventList against live data', () => {
  it('renders each event with its venue name resolved from the embedded location', async () => {
    route({ events: () => json(events) });
    renderAt('/events', '/events', <EventList />);

    for (const e of events) {
      const cell = await screen.findByText(e.name);
      const row = cell.closest('tr') as HTMLElement;
      // FR-015: the venue is embedded, so no second request is needed to show its name
      expect(within(row).getByText(e.location.name)).toBeInTheDocument();
    }
  });

  it('links each event name to its detail page', async () => {
    route({ events: () => json(events) });
    renderAt('/events', '/events', <EventList />);
    for (const e of events) {
      expect(await screen.findByRole('link', { name: e.name })).toHaveAttribute(
        'href',
        `/events/${e.id}`,
      );
    }
  });

  it('renders basePrice as the exact decimal string, never a rounded number', async () => {
    route({ events: () => json(events) });
    renderAt('/events', '/events', <EventList />);
    expect(await screen.findByText('$45.00')).toBeInTheDocument();
  });

  it('exposes no delete control: delete lives on the event page (spec 002 R3)', async () => {
    route({ events: () => json(events) });
    renderAt('/events', '/events', <EventList />);
    await screen.findByText(events[0].name);
    expect(screen.queryByText(/delete/i)).toBeNull();
  });
});

describe('LocationForm against a live validation rejection', () => {
  it('lists every field the API objected to (FR-012, FR-036)', async () => {
    route({ post: { status: 400, body: validation400 } });
    renderAt('/locations/new', '/locations/new', <LocationForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Name'), 'x');
    // Spec 013: the four address fields; the form's own checks pass, the API refuses.
    await user.type(screen.getByLabelText('Street address'), 'y');
    await user.type(screen.getByLabelText('City'), 'y');
    await user.selectOptions(screen.getByLabelText('State'), 'KY');
    await user.type(screen.getByLabelText('ZIP code'), '40202');
    // Spec 024 FR-002: a new venue needs its zone chosen.
    await user.selectOptions(screen.getByLabelText('Time zone'), 'America/New_York');
    await user.type(screen.getByLabelText('Seating capacity'), '1');
    await user.click(screen.getByRole('button', { name: /Create venue/i }));

    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveAttribute('data-code', 'VALIDATION_FAILED');
    for (const f of validation400.error.details.fields) {
      expect(banner).toHaveTextContent(f);
    }
  });
});

describe('EventForm against live rejections', () => {
  async function submit(): Promise<void> {
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /KFC Yum/ })).toBeInTheDocument(),
    );
    await user.type(screen.getByLabelText('Event name'), 'UI Test Clash');
    await user.selectOptions(
      screen.getByLabelText('Venue'),
      locations.find((l) => l.name.startsWith('KFC'))!.id,
    );
    await user.type(screen.getByLabelText('Starts'), '2026-10-01T19:30');
    await user.type(screen.getByLabelText('Ends'), '2026-10-01T20:30');
    await user.type(screen.getByLabelText('Total tickets'), '100');
    // Spec 008 US7: priced by a ticket type instead of a base price.
    await user.type(screen.getByLabelText('Ticket type 1 name'), 'General');
    await user.type(screen.getByLabelText('Ticket type 1 price'), '10.00');
    await user.type(screen.getByLabelText('Ticket type 1 quantity'), '100');
    await user.click(screen.getByRole('button', { name: /Schedule event/i }));
  }

  it('renders the conflict banner from the REAL 409 payload (FR-034)', async () => {
    route({ post: { status: 409, body: conflict409 } });
    renderAt('/events/new', '/events/new', <EventForm />);
    await submit();

    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveAttribute('data-code', 'SCHEDULING_CONFLICT');
    expect(banner).toHaveClass('banner--conflict');
    expect(banner.querySelector('strong')?.textContent).toBe('Venue already committed');
    // The conflicting event the backend actually named
    expect(await screen.findByTestId('conflict-detail')).toHaveTextContent(
      conflict409.error.details.conflictingEvent.name,
    );
  });

  it('keeps every entered value after the real rejection (FR-035)', async () => {
    route({ post: { status: 409, body: conflict409 } });
    renderAt('/events/new', '/events/new', <EventForm />);
    await submit();
    await screen.findByTestId('error-banner');

    expect(screen.getByLabelText('Event name')).toHaveValue('UI Test Clash');
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-10-01T19:30');
    expect(screen.getByLabelText('Total tickets')).toHaveValue(100);
    expect(screen.getByLabelText('Ticket type 1 price')).toHaveValue('10.00');
  });

  it('gives CAPACITY_EXCEEDED its own non-conflict treatment (FR-036)', async () => {
    route({ post: { status: 409, body: capacity409 } });
    renderAt('/events/new', '/events/new', <EventForm />);
    await submit();

    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveAttribute('data-code', 'CAPACITY_EXCEEDED');
    expect(banner).not.toHaveClass('banner--conflict');
    expect(banner).toHaveTextContent('22090');
    expect(screen.queryByTestId('conflict-detail')).toBeNull();
  });

  it('shows no success state when the save was rejected', async () => {
    route({ post: { status: 409, body: conflict409 } });
    renderAt('/events/new', '/events/new', <EventForm />);
    await submit();
    await screen.findByTestId('error-banner');
    expect(screen.queryByTestId('success-state')).toBeNull();
  });

  it('shows the success state when the save succeeds (FR-033)', async () => {
    route({ post: { status: 201, body: events[0] } });
    renderAt('/events/new', '/events/new', <EventForm />);
    await submit();

    expect(await screen.findByTestId('success-state')).toHaveTextContent('Event saved.');
    expect(screen.queryByTestId('error-banner')).toBeNull();
  });
});
