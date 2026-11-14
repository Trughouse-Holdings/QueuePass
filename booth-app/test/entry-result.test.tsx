import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { EntryTicket } from '@queuepass/shared';
import { EntryResult, type Outcome } from '../src/EntryResult';

/**
 * Spec 038 FR-026, FR-030 (research R17; quickstart S20): the gate shows a seated ticket's seat by
 * its labels as sold, and its price level.
 */
const SEATED: EntryTicket = {
  ticketId: '3b8e0000-0000-4000-8000-000000000001',
  code: '7KQ2M9XWAB4C',
  orderId: 'a1f00000-0000-4000-8000-000000000002',
  state: 'ADMITTABLE',
  event: {
    id: '7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40',
    name: "Women's Basketball",
    startsAt: '2026-11-23T00:00:00.000Z',
    endsAt: '2026-11-23T03:00:00.000Z',
    timeZone: 'America/New_York',
  },
  tierName: null,
  levelName: 'Lower sideline',
  seat: { section: '115', row: 6, seat: 7, rowLabel: 'F', seatLabel: '7' },
  holderName: 'Jordan Lee',
  usedAt: null,
  entryOpensAt: '2026-11-22T22:00:00.000Z',
  unusedOnOrder: 1,
  verifiedBy: 'TICKET_CODE',
};

const show = (outcome: Outcome) =>
  render(
    <EntryResult
      outcome={outcome}
      busy={false}
      onAdmit={vi.fn()}
      onRefuse={vi.fn()}
      onAnother={vi.fn()}
      timeZone="America/New_York"
    />,
  );

/** The facts list as term → description. */
const facts = (): Record<string, string> => {
  const list = within(screen.getByRole('status')).getAllByRole('term');
  return Object.fromEntries(
    list.map((dt) => [dt.textContent ?? '', dt.nextElementSibling?.textContent ?? '']),
  );
};

describe('the entry result for a seated ticket (038 FR-026, FR-030)', () => {
  it('shows "Section 115, Row F, Seat 7" and "Lower sideline", and no ticket type', () => {
    show({ kind: 'ticket', ticket: SEATED });
    expect(facts()).toEqual({
      Event: "Women's Basketball",
      'Price level': 'Lower sideline',
      Seat: 'Section 115, Row F, Seat 7',
      'Name on ticket': 'Jordan Lee',
    });
    expect(screen.queryByText('General admission')).not.toBeInTheDocument();
  });

  it('shows the row and seat by their labels, not their numbers', () => {
    show({
      kind: 'ticket',
      ticket: {
        ...SEATED,
        seat: { section: '101', row: 23, seat: 101, rowLabel: 'AA', seatLabel: '101' },
      },
    });
    expect(facts().Seat).toBe('Section 101, Row AA, Seat 101');
  });

  it('shows the same facts beside a refusal', () => {
    show({ kind: 'refused', message: 'Already used', ticket: { ...SEATED, state: 'USED' } });
    expect(facts()).toMatchObject({
      'Price level': 'Lower sideline',
      Seat: 'Section 115, Row F, Seat 7',
    });
  });

  it("keeps a carried-over ticket's type beside its level (R17)", () => {
    show({
      kind: 'ticket',
      ticket: { ...SEATED, tierName: 'Floor', levelName: 'Floor' },
    });
    expect(facts()).toMatchObject({ 'Ticket type': 'Floor', 'Price level': 'Floor' });
  });

  it('says "General admission" and no level or seat for a general-admission ticket', () => {
    show({ kind: 'ticket', ticket: { ...SEATED, levelName: null, seat: null } });
    expect(facts()).toEqual({
      Event: "Women's Basketball",
      'Ticket type': 'General admission',
      'Name on ticket': 'Jordan Lee',
    });
  });
});
