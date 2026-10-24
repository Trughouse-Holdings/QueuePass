import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { MyOrder, OrderEvent, Ticket } from '@queuepass/shared';
import { AuthProvider, RequireRole } from '@queuepass/shared/web';
import { App } from '../src/App';
import { calendarEntry, googleCalendarUrl, icsFile, icsFileName } from '../src/calendar';
import { releaseOnLogout } from '../src/release-on-logout';
import { json, myOrder, renderCustomer, stubApi } from './helpers';

/**
 * Spec 019 US1 and US3 (FR-001 to FR-003, FR-008 to FR-010, FR-013 to FR-015; research R10 to
 * R12): the "Add to calendar" group on My tickets, on eligible order cards only.
 */

const NOW = Date.parse('2026-10-24T15:30:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const ev = (id: string, name: string, over: Partial<OrderEvent> = {}): OrderEvent => ({
  id,
  name,
  startsAt: iso(NOW + 7 * 24 * HOUR),
  endsAt: iso(NOW + 7 * 24 * HOUR + 3 * HOUR),
  status: 'SCHEDULED',
  location: {
    id: `v-${id}`,
    name: 'KFC Yum! Center',
    address: '1 ARENA PLAZA, LOUISVILLE, KY 40202',
  },
  ...over,
});

const tk = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id,
  code: `CODE${id.toUpperCase()}`.padEnd(12, 'X'),
  status: 'VALID',
  checkedInAt: null,
  seat: null,
  ...over,
});

const upcoming = myOrder({ id: 'o-up', event: ev('e-up', 'Season Opener'), tickets: [tk('a1')] });
const underWay = myOrder({
  id: 'o-now',
  event: ev('e-now', 'Matinee', { startsAt: iso(NOW - HOUR), endsAt: iso(NOW + 2 * HOUR) }),
  tickets: [tk('b1')],
});
const cancelled = myOrder({
  id: 'o-can',
  status: 'REFUNDED',
  refundedAt: iso(NOW - 24 * HOUR),
  event: ev('e-can', 'Called Off', { status: 'CANCELLED' }),
  tickets: [tk('c1', { status: 'VOID' })],
});
const ended = myOrder({
  id: 'o-end',
  event: ev('e-end', 'Last Week', {
    startsAt: iso(NOW - 7 * 24 * HOUR),
    endsAt: iso(NOW - 7 * 24 * HOUR + 3 * HOUR),
  }),
  tickets: [tk('d1')],
});
const allVoid = myOrder({
  id: 'o-void',
  status: 'REFUNDED',
  event: ev('e-void', 'Refunded Ahead'),
  tickets: [tk('f1', { status: 'VOID' }), tk('f2', { status: 'VOID' })],
});
const used = myOrder({
  id: 'o-used',
  event: ev('e-used', 'In Progress', { startsAt: iso(NOW - HOUR), endsAt: iso(NOW + HOUR) }),
  tickets: [tk('g1', { checkedInAt: iso(NOW - 30 * 60_000) })],
});
const twinA = myOrder({ id: 'o-twin-a', event: ev('e-twin', 'Double Bill'), tickets: [tk('h1')] });
const twinB = myOrder({ id: 'o-twin-b', event: ev('e-twin', 'Double Bill'), tickets: [tk('h2')] });

const ALL = [upcoming, underWay, cancelled, ended, allVoid, used, twinA, twinB];
const ELIGIBLE = [upcoming, underWay, used, twinA, twinB];
const INELIGIBLE = [cancelled, ended, allVoid];

const NOTE = "A copy for your calendar: it won't change if the event does.";
const fileButtonName = (o: MyOrder) =>
  `Add to Apple Calendar or Outlook: ${o.event.name}, downloads a calendar file`;

let clicked: { download: string; href: string }[];
let blobs: Blob[];

beforeEach(() => {
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  vi.setSystemTime(NOW);
  clicked = [];
  blobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blobs.push(b as Blob);
    return `blob:test/calendar-${blobs.length}`;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ download: this.download, href: this.getAttribute('href') ?? '' });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const cardOf = (o: MyOrder): HTMLElement =>
  screen
    .getAllByRole('article')
    .find((a) => a.getAttribute('aria-labelledby') === `order-${o.id}`)!;

async function showAll(orders: MyOrder[] = ALL) {
  const api = stubApi({ 'GET /me/orders': json(orders) });
  const view = renderCustomer({ at: '/my-tickets' });
  await screen.findByRole('heading', { name: 'My tickets', level: 1 });
  await screen.findAllByRole('article');
  return { ...api, ...view };
}

describe('which cards offer it (FR-001, FR-002, US3, SC-005)', () => {
  it('gives each eligible card exactly one group, button, and note', async () => {
    await showAll();
    for (const o of ELIGIBLE) {
      const card = cardOf(o);
      const groups = within(card).getAllByRole('group', { name: 'Add to calendar' });
      expect(groups).toHaveLength(1);
      expect(within(groups[0]).getAllByRole('button')).toHaveLength(1);
      expect(within(groups[0]).getByRole('button', { name: fileButtonName(o) })).toBeVisible();
      expect(within(groups[0]).getAllByText(NOTE)).toHaveLength(1);
    }
  });

  it('gives ineligible cards no group, no control, no note, and nothing disabled (FR-015)', async () => {
    await showAll();
    for (const o of INELIGIBLE) {
      const card = cardOf(o);
      expect(within(card).queryByRole('group')).toBeNull();
      expect(within(card).queryAllByRole('button')).toHaveLength(0);
      expect(within(card).queryByText(/calendar/i)).toBeNull();
      expect(within(card).queryByText(NOTE)).toBeNull();
      expect(card.querySelector('[disabled], [aria-disabled="true"]')).toBeNull();
    }
  });

  it('puts no calendar control in any ticket row', async () => {
    await showAll();
    for (const li of screen.getAllByRole('listitem')) {
      expect(within(li).queryByRole('button', { name: /calendar/i })).toBeNull();
      expect(within(li).queryByRole('link', { name: /calendar/i })).toBeNull();
    }
  });
});

describe('the group (FR-003, FR-013, FR-014; research R11)', () => {
  it('puts the note first, with an id that describes the button', async () => {
    await showAll([upcoming]);
    const group = screen.getByRole('group', { name: 'Add to calendar' });
    const note = within(group).getByText(NOTE);
    const button = within(group).getByRole('button', { name: fileButtonName(upcoming) });

    expect(note.id).not.toBe('');
    expect(button).toHaveAttribute('aria-describedby', note.id);
    expect(button).toHaveAccessibleDescription(NOTE);
    expect(note.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button).toHaveClass('btn', 'btn--ghost');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('gives the two cards of one event their own ids, each resolving inside its own card', async () => {
    await showAll([twinA, twinB]);
    const ids = [twinA, twinB].map((o) => {
      const card = cardOf(o);
      const group = within(card).getByRole('group', { name: 'Add to calendar' });
      const labelId = group.getAttribute('aria-labelledby')!;
      const noteId = within(group).getByRole('button').getAttribute('aria-describedby')!;
      expect(card.querySelector(`[id="${labelId}"]`)).toHaveTextContent('Add to calendar');
      expect(card.querySelector(`[id="${noteId}"]`)).toHaveTextContent(NOTE);
      expect(document.querySelectorAll(`[id="${labelId}"]`)).toHaveLength(1);
      expect(document.querySelectorAll(`[id="${noteId}"]`)).toHaveLength(1);
      return { labelId, noteId };
    });
    expect(ids[0].labelId).not.toBe(ids[1].labelId);
    expect(ids[0].noteId).not.toBe(ids[1].noteId);
  });

  it('sits after the event details and before the ticket list', async () => {
    await showAll([upcoming]);
    const card = cardOf(upcoming);
    const group = within(card).getByRole('group', { name: 'Add to calendar' });
    const details = card.querySelector('dl')!;
    const tickets = within(card).getByRole('list', { name: 'Tickets' });
    expect(details.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.compareDocumentPosition(tickets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is reached by Tab after the event's link and before the first ticket's links", async () => {
    await showAll([upcoming]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const card = cardOf(upcoming);
    const eventLink = within(card).getByRole('link', { name: 'Season Opener' });
    const button = within(card).getByRole('button', { name: fileButtonName(upcoming) });
    const firstTicketLink = within(card).getByRole('link', { name: /^Show entry code/ });

    eventLink.focus();
    await user.tab();
    expect(button).toHaveFocus();
    // Whatever else the group holds, the first ticket's link comes after it, within a few tabs.
    for (let i = 0; i < 5 && document.activeElement !== firstTicketLink; i++) await user.tab();
    expect(firstTicketLink).toHaveFocus();
  });

  it('is decided when the orders load, not on each render (FR-002, R10)', async () => {
    const { calls, um, rerender } = await showAll([underWay]);
    expect(screen.getByRole('group', { name: 'Add to calendar' })).toBeInTheDocument();

    vi.setSystemTime(Date.parse(underWay.event.endsAt) + 60_000);
    rerender(
      <AuthProvider userManager={um} beforeLogout={releaseOnLogout}>
        <RequireRole role="customer">
          <MemoryRouter initialEntries={['/my-tickets']}>
            <App />
          </MemoryRouter>
        </RequireRole>
      </AuthProvider>,
    );

    expect(screen.getByRole('group', { name: 'Add to calendar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: fileButtonName(underWay) })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'GET' && c.path === '/me/orders')).toHaveLength(1);
  });
});

describe('saving the file (FR-008 to FR-010; research R12)', () => {
  const expectedText = (o: MyOrder) => icsFile(calendarEntry(o.event), new Date(NOW));

  it.each([
    ['a click', async (b: HTMLElement, user: ReturnType<typeof userEvent.setup>) => user.click(b)],
    [
      'Enter',
      async (b: HTMLElement, user: ReturnType<typeof userEvent.setup>) => {
        b.focus();
        await user.keyboard('{Enter}');
      },
    ],
    [
      'Space',
      async (b: HTMLElement, user: ReturnType<typeof userEvent.setup>) => {
        b.focus();
        await user.keyboard(' ');
      },
    ],
  ])('saves one file on %s, and revokes its URL 60 seconds later', async (_label, press) => {
    const { calls } = await showAll([upcoming]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.setSystemTime(NOW);

    await press(screen.getByRole('button', { name: fileButtonName(upcoming) }), user);

    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe('text/calendar;charset=utf-8');
    expect(await blobs[0].text()).toBe(expectedText(upcoming));
    expect(clicked).toEqual([{ download: 'season-opener.ics', href: 'blob:test/calendar-1' }]);
    expect(clicked[0].download).toBe(icsFileName(upcoming.event.name));
    // The temporary anchor is gone again.
    expect(document.querySelector('a[download]')).toBeNull();

    await act(async () => void (await vi.advanceTimersByTimeAsync(59_000)));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await act(async () => void (await vi.advanceTimersByTimeAsync(1_500)));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/calendar-1');

    // FR-010: no request but the one that loaded My tickets.
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /me/orders']);
  });

  it('gives both orders of one event files with the same UID (FR-007)', async () => {
    await showAll([twinA, twinB]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.click(within(cardOf(twinA)).getByRole('button', { name: fileButtonName(twinA) }));
    await user.click(within(cardOf(twinB)).getByRole('button', { name: fileButtonName(twinB) }));

    expect(blobs).toHaveLength(2);
    const uid = async (b: Blob) => (await b.text()).match(/^UID:(.*)\r$/m)?.[1];
    expect(await uid(blobs[0])).toBe('queuepass-event-e-twin');
    expect(await uid(blobs[1])).toBe(await uid(blobs[0]));
  });
});

describe('Add to Google Calendar (US2; FR-011, FR-013, FR-014; research R8, R11)', () => {
  const googleName = (o: MyOrder) => `Add to Google Calendar: ${o.event.name}, opens in a new tab`;

  it('gives each eligible card the link right after the button, opening a new tab', async () => {
    await showAll();
    for (const o of ELIGIBLE) {
      const group = within(cardOf(o)).getByRole('group', { name: 'Add to calendar' });
      const button = within(group).getByRole('button', { name: fileButtonName(o) });
      const links = within(group).getAllByRole('link');
      expect(links).toHaveLength(1);
      const link = within(group).getByRole('link', { name: googleName(o) });
      expect(link).toBe(links[0]);
      expect(link).toHaveTextContent('Add to Google Calendar');
      expect(link).toHaveAttribute('href', googleCalendarUrl(calendarEntry(o.event)));
      expect(link).toHaveAttribute('target', '_blank');
      const rel = (link.getAttribute('rel') ?? '').split(/\s+/);
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
      expect(link).toHaveClass('btn', 'btn--ghost');
      const noteId = within(group).getByText(NOTE).id;
      expect(link).toHaveAttribute('aria-describedby', noteId);
      expect(link).toHaveAccessibleDescription(NOTE);
      // Right after the button: no focusable element between them.
      expect(button.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const focusable = [...group.querySelectorAll('a[href], button')];
      expect(focusable.indexOf(link)).toBe(focusable.indexOf(button) + 1);
    }
  });

  it('gives ineligible cards no Google link', async () => {
    await showAll();
    for (const o of INELIGIBLE)
      expect(within(cardOf(o)).queryByRole('link', { name: /Google Calendar/ })).toBeNull();
  });

  it('is reached by Tab right after the button, then the first ticket link', async () => {
    await showAll([upcoming]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const card = cardOf(upcoming);

    within(card)
      .getByRole('button', { name: fileButtonName(upcoming) })
      .focus();
    await user.tab();
    expect(within(card).getByRole('link', { name: googleName(upcoming) })).toHaveFocus();
    await user.tab();
    expect(within(card).getByRole('link', { name: /^Show entry code/ })).toHaveFocus();
  });
});
