import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Event, Order } from '@queuepass/shared';
import { Attendees } from '../src/pages/Attendees';
import { save } from '../src/export/save';
import { toCsv } from '../src/export/csv';
import { attendeeTable } from '../src/export/attendee-rows';
import { fileName } from '../src/export/file-name';
import { deviceZone } from '../src/export/made';
import { fontGlyphs, pdfLayout, toPdf } from '../src/export/pdf';
import readExcelFile from 'read-excel-file/node';
import { REGULAR, loadFontsFromDisk } from './export/fonts';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, ORDERS } from './fixtures-005';

/** Spec 023 US1, US3 (FR-001, FR-003, FR-011): Download on the Attendees page. */
vi.mock('../src/export/save', () => ({ save: vi.fn() }));

const NOTE = "The file contains customers' names and usernames. Keep it private.";
const PATH = `/events/${EVENT.id}/attendees`;
const LOADED_AT = Date.UTC(2026, 9, 30, 18, 5, 0);

beforeEach(() => vi.mocked(save).mockReset());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/events/:id/attendees" element={<Attendees username="admin1" />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Download on the Attendees page', () => {
  it('is offered with the personal-data note when there are orders', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json(ORDERS) });
    renderPage();
    expect(await screen.findByText('Download')).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Download the attendee list', hidden: true }),
    ).toBeInTheDocument();
  });

  it('is not offered when no one has tickets', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json([]) });
    renderPage();
    await screen.findByText('No one has tickets for this event yet.');
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('is not offered while loading or when the list cannot load', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: 'network-error' });
    renderPage();
    expect(screen.getByText('Loading attendees…')).toBeInTheDocument();
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    await screen.findByRole('alert');
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
  });

  it("saves a CSV made from the page's own orders and load time, without a new request", async () => {
    vi.spyOn(Date, 'now').mockReturnValue(LOADED_AT);
    const api = stubApi({
      [`GET /events/${EVENT.id}`]: json(EVENT),
      [`GET ${PATH}`]: json(ORDERS),
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('Download'));
    await user.click(screen.getByRole('button', { name: 'CSV' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [blob, name] = vi.mocked(save).mock.calls[0];
    const table = attendeeTable(
      EVENT as unknown as Event,
      ORDERS as unknown as Order[],
      LOADED_AT,
      'admin1',
    );
    expect(await blob.text()).toBe(await toCsv(table).text());
    expect(name).toBe(fileName('attendees', 'Season Opener', table.madeAt, deviceZone(), 'csv'));
    expect(name).toMatch(/^attendees-season-opener-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/);
    expect(api.count('GET', PATH)).toBe(1);
  });
});

/** Spec 038 FR-030 (research R17; 023 FR-004 as amended): a seated order of two levels. */
const SEATED = {
  ...ORDERS[0],
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  tierId: null,
  tierName: null,
  customerUsername: 'customer4',
  holderName: 'Sam Park',
  unitPrice: null,
  totalPrice: '155.00',
  tickets: [
    {
      ...ORDERS[0].tickets[1],
      id: 'e1111111-1111-4111-8111-111111111111',
      code: 'BCDFGHJK2345',
      seat: { section: '115', row: 4, seat: 2, rowLabel: 'D', seatLabel: '2' },
      price: '95.00',
      levelName: 'Courtside',
    },
    {
      ...ORDERS[0].tickets[1],
      id: 'e2222222-2222-4222-8222-222222222222',
      code: 'LMNPQRST6789',
      seat: { section: '115', row: 6, seat: 7, rowLabel: 'F', seatLabel: '7' },
      price: '60.00',
      levelName: 'Lower sideline',
    },
  ],
};

describe('a Price level column and a Price per ticket in every format (038 FR-030)', () => {
  const download = async (button: string) => {
    vi.spyOn(Date, 'now').mockReturnValue(LOADED_AT);
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json([SEATED]) });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('Download'));
    await user.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    return vi.mocked(save).mock.calls[0][0];
  };
  const table = () =>
    attendeeTable(EVENT as unknown as Event, [SEATED] as unknown as Order[], LOADED_AT, 'admin1');

  it('CSV', async () => {
    const lines = (await (await download('CSV')).text()).replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toMatch(/^Order placed,Customer,Name on tickets,Tier,Price level,Seat,/);
    expect(lines[1]).toContain(',,Courtside,"Section 115, Row D, Seat 2",BCDFGHJK2345,');
    expect(lines[1]).toContain(',Confirmed,95.00,EEEEEEEE,');
    expect(lines[2]).toContain(',,Lower sideline,"Section 115, Row F, Seat 7",LMNPQRST6789,');
    expect(lines[2]).toContain(',Confirmed,60.00,EEEEEEEE,');
  });

  it('Excel', async () => {
    const blob = await download('Excel (XLSX)');
    const [sheet] = await readExcelFile(Buffer.from(await blob.arrayBuffer()));
    const [head, first, second] = sheet.data;
    const level = head.indexOf('Price level');
    const price = head.indexOf('Price');
    expect(level).toBe(head.indexOf('Tier') + 1);
    expect([first[level], first[price]]).toEqual(['Courtside', 95]);
    expect([second[level], second[price]]).toEqual(['Lower sideline', 60]);
  });

  it('PDF', async () => {
    // The page's PDF is made from the same table as its CSV (above); the writer draws this layout.
    const blob = await toPdf(table(), loadFontsFromDisk);
    expect(blob.type).toBe('application/pdf');
    const layout = pdfLayout(table(), fontGlyphs(REGULAR));
    const level = layout.head.indexOf('Price level');
    const price = layout.head.indexOf('Price');
    expect(level).toBe(layout.head.indexOf('Tier') + 1);
    expect(layout.body.map((r) => [r[level], r[price]])).toEqual([
      ['Courtside', '$95.00'],
      ['Lower sideline', '$60.00'],
    ]);
  });
});
