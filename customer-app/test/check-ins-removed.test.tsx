import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { json, myOrder, renderCustomer, stubApi } from './helpers';

/**
 * Spec 032 FR-014 (research R9): once an event's check-in details are removed, a valid ticket of
 * it reads "Event over", with no entry code and no printable ticket, so a used ticket never turns
 * back into one that looks usable. Void tickets read "Void" as today.
 */
afterEach(() => vi.unstubAllGlobals());

const REMOVED_AT = '2026-11-10T03:00:00Z';
const TICKETS = [
  // Used before the removal; its checkedInAt is gone now, like every other ticket's.
  { id: 'k1', code: 'AAAA2222BBBB', status: 'VALID' as const, checkedInAt: null, seat: null },
  { id: 'k2', code: 'CCCC3333DDDD', status: 'VALID' as const, checkedInAt: null, seat: null },
  { id: 'k3', code: 'GGGG5555HHHH', status: 'VOID' as const, checkedInAt: null, seat: null },
];
const withRemoval = (removedAt: string | null) => {
  const base = myOrder({ tickets: TICKETS });
  return { ...base, event: { ...base.event, checkInDetailsRemovedAt: removedAt } };
};

describe('My tickets for a removed event (FR-014)', () => {
  it('reads "Event over" for each valid ticket, with no entry code or print link', async () => {
    stubApi({ 'GET /me/orders': json([withRemoval(REMOVED_AT)]) });
    renderCustomer({ at: '/my-tickets' });

    const list = within(await screen.findByRole('list', { name: 'Tickets' }));
    const items = list.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      'AAAA2222BBBB: Event over',
      'CCCC3333DDDD: Event over',
      'GGGG5555HHHH: Void',
    ]);
    expect(screen.queryByRole('link', { name: /Show entry code/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Print ticket/ })).not.toBeInTheDocument();
  });

  it('refuses the printable ticket of such a ticket', async () => {
    stubApi({ 'GET /me/orders': json([withRemoval(REMOVED_AT)]) });
    renderCustomer({ at: '/my-tickets/k1/print' });

    expect(await screen.findByText("This ticket can't be printed.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('is as today for an event not removed', async () => {
    stubApi({ 'GET /me/orders': json([withRemoval(null)]) });
    renderCustomer({ at: '/my-tickets' });

    const list = within(await screen.findByRole('list', { name: 'Tickets' }));
    expect(list.getAllByRole('listitem')[0].textContent).toContain('AAAA2222BBBB: Valid');
    expect(screen.getAllByRole('link', { name: /Print ticket/ })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: /Show entry code/ })).toHaveLength(2);
  });
});
