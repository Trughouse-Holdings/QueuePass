import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import qrcode from 'qrcode-generator';
import { qrMatrix } from '../src/components/TicketQr';
import { json, myOrder, renderCustomer, stubApi } from './helpers';

/**
 * Spec 017 US5 (FR-012, FR-013): a printable view per valid, unused ticket — a QR code that
 * encodes the ticket's code and nothing else, the code in text, the name, the event, and the seat.
 */
afterEach(() => vi.unstubAllGlobals());

const CODE = 'AAAA2222BBBB';

const mixed = myOrder({
  tickets: [
    { id: 'k1', code: CODE, status: 'VALID', checkedInAt: null, seat: null },
    {
      id: 'k2',
      code: 'CCCC3333DDDD',
      status: 'VALID',
      checkedInAt: '2026-12-01T23:10:00.000Z',
      seat: null,
    },
    { id: 'k3', code: 'GGGG5555HHHH', status: 'VOID', checkedInAt: null, seat: null },
  ],
});

describe('Print ticket on My tickets (US5-1, US5-2)', () => {
  it('offers Print ticket for valid, unused tickets only', async () => {
    stubApi({ 'GET /me/orders': json([mixed]) });
    renderCustomer({ at: '/my-tickets' });

    await screen.findByRole('heading', { name: 'My tickets', level: 1 });
    const links = screen.getAllByRole('link', { name: /^Print ticket/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(`Print ticket ${CODE}`);
    expect(links[0]).toHaveAttribute('href', '/my-tickets/k1/print');
  });
});

describe('the printable view (US5-1)', () => {
  it('shows the QR code, the code in text, the name, the event, venue, start time, and seat', async () => {
    const seated = myOrder({
      tickets: [
        {
          id: 'k1',
          code: CODE,
          status: 'VALID',
          checkedInAt: null,
          seat: { section: 'A', row: 3, seat: 7 },
        },
      ],
    });
    stubApi({ 'GET /me/orders': json([seated]) });
    renderCustomer({ at: '/my-tickets/k1/print' });

    expect(
      await screen.findByRole('img', { name: `QR code for ticket ${CODE}` }),
    ).toBeInTheDocument();
    expect(screen.getByText(CODE)).toBeInTheDocument();
    expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
    expect(screen.getByText('Early Show')).toBeInTheDocument();
    expect(screen.getByText('Alpha Arena')).toBeInTheDocument();
    expect(screen.getByText('Section A, Row 3, Seat 7')).toBeInTheDocument();
  });

  it('says "No name on ticket" for an order without a name', async () => {
    stubApi({ 'GET /me/orders': json([myOrder({ holderName: null })]) });
    renderCustomer({ at: '/my-tickets/k1/print' });
    expect(await screen.findByText('No name on ticket')).toBeInTheDocument();
  });

  it('Print calls window.print', async () => {
    stubApi({ 'GET /me/orders': json([myOrder()]) });
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderCustomer({ at: '/my-tickets/k1/print' });

    (await screen.findByRole('button', { name: 'Print' })).click();
    expect(print).toHaveBeenCalled();
  });

  it("shows Ticket not found for an id that isn't one of the caller's tickets", async () => {
    stubApi({ 'GET /me/orders': json([myOrder()]) });
    renderCustomer({ at: '/my-tickets/not-mine/print' });
    expect(await screen.findByText('Ticket not found.')).toBeInTheDocument();
  });

  it("refuses to print a used or void ticket, whose link My tickets doesn't offer", async () => {
    stubApi({ 'GET /me/orders': json([mixed]) });
    renderCustomer({ at: '/my-tickets/k2/print' });
    expect(await screen.findByText("This ticket can't be printed.")).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /QR code/ })).not.toBeInTheDocument();
  });
});

describe('qrMatrix (FR-012, research R8)', () => {
  it('is 21 × 21 for a 12-character code, the same matrix qrcode-generator makes', () => {
    const matrix = qrMatrix(CODE);
    expect(matrix).toHaveLength(21);
    for (const row of matrix) expect(row).toHaveLength(21);

    const qr = qrcode(0, 'M');
    qr.addData(CODE, 'Alphanumeric');
    qr.make();
    expect(qr.getModuleCount()).toBe(21);
    for (let r = 0; r < 21; r++) {
      for (let c = 0; c < 21; c++) {
        expect(matrix[r][c]).toBe(qr.isDark(r, c));
      }
    }
  });
});
