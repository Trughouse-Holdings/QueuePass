import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import readExcelFile from 'read-excel-file/node';
import { AuthProvider } from '@queuepass/shared/web';
import type { SalesReport } from '@queuepass/shared';
import { App } from '../src/App';
import { Reports } from '../src/pages/Reports';
import { save } from '../src/export/save';
import { toCsv } from '../src/export/csv';
import { salesTable } from '../src/export/sales-rows';
import { json, stubApi } from './helpers/api-stub';
import { REPORT } from './fixtures-005';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';
import { fixTimeBeforeFixtures } from './helpers/fixed-time';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/** Spec 023 US2, US3 (FR-002, FR-003, R13a): Download on the Reports page. */
vi.mock('../src/export/save', () => ({ save: vi.fn() }));

beforeEach(() => vi.mocked(save).mockReset());
afterEach(() => vi.unstubAllGlobals());

const renderReports = () =>
  render(
    <MemoryRouter initialEntries={['/reports']}>
      <Routes>
        <Route path="/reports" element={<Reports username="admin2" />} />
      </Routes>
    </MemoryRouter>,
  );

/** Spec 038 FR-030: a seated event, its sales by price level (`EventSales.levels`). */
const SEATED_REPORT = {
  ...REPORT,
  events: REPORT.events.map((e, i) =>
    i === 0
      ? {
          ...e,
          tiers: [],
          levels: [
            {
              levelId: '55555555-5555-4555-8555-555555555555',
              name: 'Courtside',
              price: '95.00',
              seatsOnSale: 30,
              ticketsSold: 25,
              revenue: '1321.50',
            },
          ],
        }
      : { ...e, levels: [] },
  ),
};

describe('Download on the Reports page', () => {
  it('is offered when the report is shown, and not while loading', async () => {
    stubApi({ 'GET /reports/sales': json(REPORT) });
    renderReports();
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    expect(await screen.findByText('Download')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Download the sales report', hidden: true }),
    ).toBeInTheDocument();
  });

  it('is not offered when the report cannot load', async () => {
    stubApi({ 'GET /reports/sales': 'network-error' });
    renderReports();
    await screen.findByRole('alert');
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
  });

  it('saves a CSV made at generatedAt', async () => {
    stubApi({ 'GET /reports/sales': json(REPORT) });
    const user = userEvent.setup();
    renderReports();
    await user.click(await screen.findByText('Download'));
    await user.click(screen.getByRole('button', { name: 'CSV' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [blob, name] = vi.mocked(save).mock.calls[0];
    const table = salesTable(REPORT as unknown as SalesReport, 'admin2');
    expect(await blob.text()).toBe(await toCsv(table).text());
    expect(name).toMatch(/^sales-report-2026-10-0[01]-\d{4}\.csv$/);
  });

  it("keeps one row per event for a seated event, with the page's figures (023 FR-005; 038 R17)", async () => {
    stubApi({ 'GET /reports/sales': json(SEATED_REPORT) });
    const user = userEvent.setup();
    renderReports();
    await user.click(await screen.findByText('Download'));
    await user.click(screen.getByRole('button', { name: 'CSV' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [blob] = vi.mocked(save).mock.calls[0];
    const csv = await blob.text();
    const lines = csv.trim().split('\r\n');
    // A header, one row per event, then Total; no row per level.
    expect(lines).toHaveLength(1 + SEATED_REPORT.events.length + 1);
    expect(lines[1]).toMatch(/^Season Opener,Yum Center,.*,25,100,1321\.50,12,/);
    expect(csv).not.toContain('Courtside');
  });

  it("names the signed-in admin as made by, from the app's sign-in (R13a)", async () => {
    stubApi({ 'GET /reports/sales': json(REPORT) });
    const user = userEvent.setup();
    render(
      <AuthProvider
        userManager={fakeUserManager(makeUser({ username: 'admin1', roles: ['queuepass-admin'] }))}
      >
        <MemoryRouter initialEntries={['/reports']}>
          <App />
        </MemoryRouter>
      </AuthProvider>,
    );
    await user.click(await screen.findByText('Download'));
    await user.click(screen.getByRole('button', { name: 'Excel (XLSX)' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [blob] = vi.mocked(save).mock.calls[0];
    const sheets = await readExcelFile(Buffer.from(await blob.arrayBuffer()));
    expect(sheets[1].data.map((r) => r[0])).toContain('Made by admin1');
  });
});
